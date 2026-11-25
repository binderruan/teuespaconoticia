const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const NEWS_DIR = path.join(__dirname, "noticias");
const STATE_FILE = path.join(NEWS_DIR, "facebook-publicadas.json");
const GRAPH_VERSION = "v27.0";
const SITE_URL = "https://www.teuespaco.com.br";
const FALLBACK_NEWS_IMAGE = SITE_URL + "/images/clients/bannernews.png";

function nomeDaPagina(nome) {
  const base = nome.replace(/\.md$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  const hash = crypto.createHash("sha1").update(nome).digest("hex").slice(0, 10);
  return "materia-" + (base || "noticia") + "-" + hash + ".html";
}

function readFrontmatterValue(markdown, field) {
  const match = markdown.match(new RegExp("^" + field + ":\\s*(.*)$", "mi"));
  if (!match) return "";
  const raw = match[1].trim();
  if (raw.startsWith('"')) { try { return JSON.parse(raw); } catch (_) {} }
  if (raw.startsWith("\'") && raw.endsWith("\'")) return raw.slice(1, -1).replace(/\'\'/g, "\'");
  return raw;
}

function readTitle(markdown) {
  const match = markdown.match(/^title:\s*(.*)$/mi);
  if (!match) return "Notícia";
  const raw = match[1].trim();
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw); } catch (_) {}
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

async function graphGet(pathname, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", PAGE_TOKEN);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error("Falha ao validar o token da Página: " + JSON.stringify(data));
  return data;
}

async function validatePageToken() {
  const identity = await graphGet("me", { fields: "id,name" });
  if (String(identity.id) !== String(PAGE_ID)) {
    throw new Error(
      "O Secret FACEBOOK_PAGE_ACCESS_TOKEN não é um token da Página Teu Espaço. " +
      "O token informado representa " + identity.name + " (" + identity.id + "). " +
      "Gere/seleciona o token de acesso da Página Teu Espaço e atualize o Secret."
    );
  }
  console.log("Token validado para a Página: " + identity.name + " (" + identity.id + ").");
}

async function waitForArticlePage(link, title) {
  // Aguarda o deploy e tenta obter a imagem de capa da notícia.
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const response = await fetch(link, {
        headers: { "User-Agent": "facebookexternalhit/1.1" },
        redirect: "follow"
      });
      const html = await response.text();
      const hasOpenGraph = response.ok
        && /<meta[^>]+property=["']og:title["']/i.test(html)
        && /<meta[^>]+property=["']og:image["']/i.test(html);
      if (hasOpenGraph) {
        const imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        let imageUrl = imageMatch ? imageMatch[1] : "";
        if (imageUrl) {
          imageUrl = imageUrl.replace(/&amp;/g, "&");
          if (imageUrl.startsWith("/")) imageUrl = new URL(imageUrl, link).href;
          console.log("Página da notícia disponível. Imagem encontrada: " + imageUrl);
        } else {
          console.log("A notícia não informou uma imagem Open Graph. Será usado o banner padrão.");
        }
        return imageUrl;
      }
      console.log("Aguardando deploy da notícia (" + attempt + "/30). HTTP " + response.status);
    } catch (error) {
      console.log("Aguardando página da notícia (" + attempt + "/30): " + error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error("A página da notícia não ficou disponível após 5 minutos: " + link);
}

async function publishToFacebook(message, imageUrl) {
  const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/photos`;
  const body = new URLSearchParams({ url: imageUrl, caption: message, access_token: PAGE_TOKEN });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const result = await response.json();
  if (!response.ok || !result.id) {
    throw new Error("A Meta recusou a publicação: " + JSON.stringify(result));
  }
  return result.id;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!state.published || typeof state.published !== "object") {
      throw new Error("formato inesperado");
    }
    return state;
  } catch (error) {
    throw new Error("O arquivo noticias/facebook-publicadas.json está inválido: " + error.message);
  }
}

async function main() {
  if (!PAGE_ID || !PAGE_TOKEN) {
    throw new Error("Configure os Secrets FACEBOOK_PAGE_ID e FACEBOOK_PAGE_ACCESS_TOKEN no GitHub.");
  }
  if (!fs.existsSync(NEWS_DIR)) throw new Error("Pasta noticias não encontrada.");

  const files = fs.readdirSync(NEWS_DIR)
    .filter(name => /^agencia-brasil-.*\.md$/i.test(name))
    .sort();

  let state = loadState();

  // Primeira execução: registra o acervo atual para não publicar notícias antigas em massa.
  if (state === null) {
    state = {
      published: {},
      initialized_at: new Date().toISOString(),
      note: "Acervo existente na configuração inicial; somente notícias adicionadas depois serão publicadas."
    };
    for (const filename of files) {
      state.published[filename] = { status: "baseline" };
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
    console.log("Controle inicial criado com " + files.length + " notícias existentes. Nenhuma publicação antiga foi enviada.");
    return;
  }

  const pending = files.filter(filename => !state.published[filename]);
  if (pending.length === 0) {
    console.log("Nenhuma notícia nova pendente para o Facebook.");
    return;
  }

  await validatePageToken();

  for (const filename of pending) {
    const filepath = path.join(NEWS_DIR, filename);
    const markdown = fs.readFileSync(filepath, "utf8");
    const title = readTitle(markdown);
    const articleUrl = "https://teuespaco.com.br/" + nomeDaPagina(filename);
    // Mantém a chamada para ação e as hashtags, sem colocar um segundo URL
    // na legenda. O único link é o endereço direto desta notícia.
    const message = title
      + "\n\nAcesse e confira:➡️"
      + "\n\n#TeuEspaço #Radio #Jornal #Canoinhas #Brasil #SantaCatarina #Notícia #informação";

    await waitForArticlePage(articleUrl, title);
    const postId = await publishToFacebook(message, articleUrl);
    state.published[filename] = {
      post_id: postId,
      published_at: new Date().toISOString()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
    console.log("Publicada no Facebook: " + title + " (post " + postId + ")");
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
