const fs = require("fs");
const path = require("path");

const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const NEWS_DIR = path.join(__dirname, "noticias");
const PENDING_FILE = path.join(process.env.RUNNER_TEMP || __dirname, "noticias-facebook-pendentes.json");
const STATE_FILE = path.join(NEWS_DIR, "facebook-publicadas.json");
const GRAPH_VERSION = "v27.0";

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

async function publishToFacebook(message, link) {
  const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/feed`;
  const body = new URLSearchParams({
    message,
    link,
    access_token: ACCESS_TOKEN
  });

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

async function main() {
  if (!PAGE_ID || !ACCESS_TOKEN) {
    throw new Error("Configure FACEBOOK_PAGE_ID e FACEBOOK_PAGE_ACCESS_TOKEN nos Secrets do GitHub.");
  }
  if (!fs.existsSync(PENDING_FILE)) {
    throw new Error("Arquivo com as notícias desta execução não foi encontrado: " + PENDING_FILE);
  }

  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
  if (!Array.isArray(pending) || pending.length === 0) {
    console.log("Nenhuma notícia nova para publicar no Facebook.");
    return;
  }

  let state = { published: {} };
  if (fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (!state.published) state.published = {};
    } catch (_) {
      throw new Error("O arquivo noticias/facebook-publicadas.json está inválido.");
    }
  }

  for (const filename of pending) {
    if (state.published[filename]) {
      console.log("Já publicada no Facebook; ignorando: " + filename);
      continue;
    }

    const filepath = path.join(NEWS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      throw new Error("Arquivo de notícia não encontrado: " + filename);
    }

    const title = readTitle(fs.readFileSync(filepath, "utf8"));
    const articleUrl = "https://www.teuespaco.com.br/noticia.html?post=" + encodeURIComponent(filename);
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
