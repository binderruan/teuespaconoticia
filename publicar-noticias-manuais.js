const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const NEWS_DIR = path.join(__dirname, "noticias");
const STATE_FILE = path.join(NEWS_DIR, "facebook-manuais-publicadas.json");
const GRAPH_VERSION = "v27.0";
const SITE_URL = "https://teuespaco.com.br";

function changedManualFiles() {
  const requested = String(process.env.NEWS_FILE || "").trim();
  if (requested) {
    const normalized = requested.replace(/\\/g, "/");
    if (!normalized.startsWith("noticias/") || !normalized.endsWith(".md") || normalized.includes("..")) {
      throw new Error("O arquivo informado precisa ser um Markdown dentro de noticias/.");
    }
    return [path.basename(normalized)];
  }
  const before = process.env.GITHUB_EVENT_BEFORE;
  const after = process.env.GITHUB_SHA;
  if (!before || !after || /^0+$/.test(before)) return [];
  const changed = execFileSync("git", ["diff", "--diff-filter=A", "--name-only", before, after, "--", "noticias"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  return changed.map(file => path.basename(file)).filter(name => name.endsWith(".md") && !/^agencia-brasil-/i.test(name));
}

function readFrontmatterValue(markdown, field) {
  const lines = String(markdown || "").split(/\r?\n/);
  if (lines[0] !== "---") return "";
  const end = lines.indexOf("---", 1);
  if (end < 0) return "";
  const key = new RegExp("^" + field + ":\\s*(.*)$");
  const index = lines.slice(1, end).findIndex(line => key.test(line));
  if (index < 0) return "";
  const absolute = index + 1;
  let value = lines[absolute].replace(key, "$1").trim();
  let i = absolute + 1;
  while (i < end && /^\s+\S/.test(lines[i]) && !/^\s+[A-Za-z0-9_-]+:\s*/.test(lines[i])) {
    value += " " + lines[i].trim();
    i++;
  }
  if (value.startsWith('"')) { try { value = JSON.parse(value); } catch (_) {} }
  else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function nomeDaPagina(nome) {
  const base = nome.replace(/\.md$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  const hash = crypto.createHash("sha1").update(nome).digest("hex").slice(0, 10);
  return "materia-" + (base || "noticia") + "-" + hash + ".html";
}

async function graphGet(pathname, params = {}) {
  const url = new URL("https://graph.facebook.com/" + GRAPH_VERSION + "/" + pathname);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", PAGE_TOKEN);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error("Falha ao validar token da Página: " + JSON.stringify(data));
  return data;
}

async function validatePageToken() {
  const identity = await graphGet("me", { fields: "id,name" });
  if (String(identity.id) !== String(PAGE_ID)) throw new Error("O token configurado não corresponde à Página Teu Espaço: " + JSON.stringify(identity));
  console.log("Token validado para a Página " + identity.name + ".");
}

async function waitForArticlePage(link) {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const response = await fetch(link, { headers: { "User-Agent": "facebookexternalhit/1.1" }, redirect: "follow" });
      const html = await response.text();
      if (response.ok && /property=["']og:title["']/i.test(html) && /property=["']og:image["']/i.test(html)) return;
      console.log("Aguardando publicação do site (" + attempt + "/30). HTTP " + response.status);
    } catch (error) {
      console.log("Aguardando deploy (" + attempt + "/30): " + error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error("A página não ficou disponível com metadados Open Graph em até 5 minutos: " + link);
}

async function publishPhoto(message, imageUrl) {
  const response = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + PAGE_ID + "/photos", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ url: imageUrl, caption: message, access_token: PAGE_TOKEN })
  });
  const result = await response.json();
  if (!response.ok || !(result.post_id || result.id)) throw new Error("A Meta recusou a publicação da foto: " + JSON.stringify(result));
  return result.post_id || result.id;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { published: {} };
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  if (!state.published || typeof state.published !== "object") throw new Error("O controle de publicações manuais está inválido.");
  return state;
}

async function main() {
  if (!PAGE_ID || !PAGE_TOKEN) throw new Error("Configure FACEBOOK_PAGE_ID e FACEBOOK_PAGE_ACCESS_TOKEN nos Secrets do GitHub.");
  if (!fs.existsSync(NEWS_DIR)) throw new Error("Pasta noticias não encontrada.");
  const files = changedManualFiles();
  if (!files.length) {
    console.log("Nenhuma notícia manual nova neste envio. Nenhuma publicação realizada.");
    return;
  }
  const state = loadState();
  const pending = files.filter(name => fs.existsSync(path.join(NEWS_DIR, name)) && !state.published[name]);
  if (!pending.length) {
    console.log("Os arquivos deste envio já foram publicados ou não existem. Nada a fazer.");
    return;
  }
  await validatePageToken();
  for (const filename of pending) {
    const markdown = fs.readFileSync(path.join(NEWS_DIR, filename), "utf8");
    const title = readFrontmatterValue(markdown, "title") || path.basename(filename, ".md");
    const link = SITE_URL + "/" + nomeDaPagina(filename);
    const thumbnail = readFrontmatterValue(markdown, "thumbnail");
    if (!/^https:\/\//i.test(thumbnail)) throw new Error("A notícia " + filename + " não possui uma thumbnail HTTPS válida no frontmatter.");
    const message = title + "\n\nAcesse e confira: " + link + "\n\n#TeuEspaço #Radio #Jornal #Canoinhas #Brasil #SantaCatarina #Notícia #informação";
    await waitForArticlePage(link);
    const postId = await publishPhoto(message, thumbnail);
    state.published[filename] = { post_id: postId, title, url: link, published_at: new Date().toISOString() };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
    console.log("Notícia manual publicada no Facebook: " + title + " (post " + postId + ")");
  }
}
main().catch(error => { console.error(error); process.exit(1); });
