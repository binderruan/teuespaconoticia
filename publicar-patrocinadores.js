const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "data", "patrocinadores.json");
const CLIENTS_DIR = path.join(__dirname, "images", "clients");
const GRAPH_VERSION = "v27.0";

const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const IG_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

function required(value, name) {
  if (!value) throw new Error("Configure o secret " + name + ".");
  return value;
}

async function graphPost(url, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Meta API: " + JSON.stringify(data));
  return data;
}

async function validateFacebook() {
  const response = await fetch(
    "https://graph.facebook.com/" + GRAPH_VERSION + "/me?fields=id,name&access_token=" + encodeURIComponent(PAGE_TOKEN)
  );
  const data = await response.json();
  if (!response.ok || String(data.id) !== String(PAGE_ID)) {
    throw new Error("Token do Facebook não corresponde à Página configurada: " + JSON.stringify(data));
  }
  console.log("Página validada: " + data.name);
}

async function publishFacebook(imageUrl, caption) {
  const data = await graphPost(
    "https://graph.facebook.com/" + GRAPH_VERSION + "/" + PAGE_ID + "/photos",
    { url: imageUrl, caption },
    PAGE_TOKEN
  );
  if (!data.id && !data.post_id) throw new Error("Facebook não retornou ID da publicação.");
  console.log("Patrocinador publicado no Facebook: " + (data.post_id || data.id));
}

async function waitForInstagramContainer(containerId) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const url = "https://graph.facebook.com/" + GRAPH_VERSION + "/" + containerId
      + "?fields=status_code&access_token=" + encodeURIComponent(IG_TOKEN);
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error("Falha ao consultar contêiner do Instagram: " + JSON.stringify(data));
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error("Instagram não processou a imagem: " + JSON.stringify(data));
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error("Tempo esgotado aguardando processamento da imagem pelo Instagram.");
}

async function publishInstagram(imageUrl, caption) {
  const container = await graphPost(
    "https://graph.facebook.com/" + GRAPH_VERSION + "/" + IG_ID + "/media",
    { image_url: imageUrl, caption },
    IG_TOKEN
  );
  if (!container.id) throw new Error("Instagram não criou o contêiner de mídia.");
  await waitForInstagramContainer(container.id);
  const published = await graphPost(
    "https://graph.facebook.com/" + GRAPH_VERSION + "/" + IG_ID + "/media_publish",
    { creation_id: container.id },
    IG_TOKEN
  );
  if (!published.id) throw new Error("Instagram não confirmou a publicação.");
  console.log("Patrocinador publicado no Instagram: " + published.id);
}

async function main() {
  required(PAGE_ID, "FACEBOOK_PAGE_ID");
  required(PAGE_TOKEN, "FACEBOOK_PAGE_ACCESS_TOKEN");
  required(IG_ID, "INSTAGRAM_ACCOUNT_ID");
  required(IG_TOKEN, "INSTAGRAM_ACCESS_TOKEN");

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!Array.isArray(config.assets) || config.assets.length !== 22) {
    throw new Error("A lista oficial deve conter exatamente 22 imagens.");
  }

  const now = new Date();
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23"
  }).format(now));
  const slot = [10, 14, 19].find(h => h === hour);
  const publicationKey = local + "-" + (slot || "manual-" + now.toISOString().slice(11,16));

  if (config.published[publicationKey]) {
    console.log("Este horário já foi processado: " + publicationKey);
    return;
  }

  const filename = config.assets[(config.last_index + 1) % config.assets.length];
  const filePath = path.join(CLIENTS_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error("Imagem não encontrada: " + filename);

  const imageUrl = "https://teuespaco.com.br/images/clients/" + encodeURIComponent(filename);
  const caption = config.caption;

  await validateFacebook();
  await publishFacebook(imageUrl, caption);
  await publishInstagram(imageUrl, caption);

  config.last_index = (config.last_index + 1) % config.assets.length;
  config.published[publicationKey] = {
    file: filename,
    published_at: new Date().toISOString(),
    facebook: true,
    instagram: true
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log("Concluído: " + filename + " para Facebook e Instagram.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
