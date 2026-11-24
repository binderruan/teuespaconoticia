const fs = require("fs");
const path = require("path");

const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PAGE_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const GRAPH_VERSION = "v27.0";
const QUEUE_FILE = path.join(__dirname, "data", "fila-publicacoes.json");

async function graph(pathname, params, method = "GET") {
  const url = new URL("https://graph.facebook.com/" + GRAPH_VERSION + "/" + pathname);
  const options = {method, headers:{}};
  if (method === "GET") {
    for (const [k,v] of Object.entries(params || {})) url.searchParams.set(k,String(v));
    url.searchParams.set("access_token", PAGE_TOKEN);
  } else {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams({...params,access_token:PAGE_TOKEN});
  }
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  if (!PAGE_ID || !PAGE_TOKEN) throw new Error("Configure FACEBOOK_PAGE_ID e FACEBOOK_PAGE_ACCESS_TOKEN nos GitHub Secrets.");
  if (!fs.existsSync(QUEUE_FILE)) {
    fs.mkdirSync(path.dirname(QUEUE_FILE), {recursive:true});
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({queue:[]},null,2)+"\n");
  }
  const identity = await graph("me",{fields:"id,name"});
  if (String(identity.id) !== String(PAGE_ID)) throw new Error("O token informado não pertence à Página configurada: "+identity.name);

  const data = JSON.parse(fs.readFileSync(QUEUE_FILE,"utf8"));
  const queue = Array.isArray(data.queue) ? data.queue : [];
  const now = Date.now();
  let changed = false;

  for (const item of queue) {
    if (item.status !== "Aprovado" || !item.agendado || new Date(item.agendado).getTime() > now) continue;
    try {
      const result = await graph(PAGE_ID+"/feed",{message:item.legenda,link:item.link},"POST");
      item.status = "Publicado";
      item.postId = result.id;
      item.publicadoEm = new Date().toISOString();
      item.erro = null;
      console.log("Publicado: "+item.titulo+" ("+result.id+")");
    } catch (error) {
      item.status = "Erro na publicação";
      item.erro = String(error.message || error);
      item.tentativaEm = new Date().toISOString();
      console.error("Falha ao publicar "+item.titulo+": "+item.erro);
    }
    changed = true;
  }

  if (changed) fs.writeFileSync(QUEUE_FILE,JSON.stringify({queue},null,2)+"\n");
  else console.log("Nenhuma publicação aprovada chegou ao horário.");
}

main().catch(error=>{console.error(error);process.exit(1);});
