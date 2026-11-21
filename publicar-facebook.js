const fs = require("fs");
const path = require("path");

const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const NEWS_DIR = path.join(__dirname, "noticias");
const STATE_FILE = path.join(NEWS_DIR, "facebook-publicadas.json");
const GRAPH_VERSION = "v27.0";
const SITE_URL = "https://www.teuespaco.com.br";

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

async function publishToFacebook(message, link) {
  const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/feed`;
  const body = new URLSearchParams({ message, link, access_token: PAGE_TOKEN });
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
    const articleUrl = SITE_URL + "/noticia.html?post=" + encodeURIComponent(filename);
    const message = title
      + "\n\nAcesse e confira:➡️ www.teuespaco.com.br/\n\n"
      + "#TeuEspaço #Radio #Jornal #Canoinhas #Brasil #SantaCatarina #Notícia #informação";

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
