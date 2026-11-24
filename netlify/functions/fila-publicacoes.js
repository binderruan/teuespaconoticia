const SITE_URL = "https://teuespaco.com.br";
const REPO = "binderruan/teuespaconoticia";
const FILE_PATH = "data/fila-publicacoes.json";

async function validarUsuario(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const response = await fetch(SITE_URL + "/.netlify/identity/user", {headers:{Authorization:auth}});
  if (!response.ok) return null;
  const user = await response.json();
  return user && user.email ? user : null;
}

async function githubRequest(method, sha, content) {
  const token = process.env.GITHUB_QUEUE_TOKEN;
  if (!token) throw new Error("Configuração pendente: GITHUB_QUEUE_TOKEN não está definida na Netlify.");
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const url = "https://api.github.com/repos/" + REPO + "/contents/" + FILE_PATH;
  if (method === "GET") {
    const r = await fetch(url, {headers});
    if (r.status === 404) return {queue:[], sha:null};
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || "Falha ao ler a fila no GitHub.");
    return {queue:JSON.parse(Buffer.from(d.content.replace(/\n/g,""),"base64").toString("utf8")).queue || [], sha:d.sha};
  }
  const payload = {
    message: "Atualiza fila de publicações agendadas",
    content: Buffer.from(JSON.stringify({queue:content}, null, 2) + "\n").toString("base64")
  };
  if (sha) payload.sha = sha;
  const r = await fetch(url, {method:"PUT",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || "Falha ao salvar a fila no GitHub.");
  return {ok:true};
}

exports.handler = async (event) => {
  const headers = {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
  if (!["GET","POST"].includes(event.httpMethod)) return {statusCode:405,headers,body:JSON.stringify({error:"Método não permitido."})};
  try {
    const user = await validarUsuario(event);
    if (!user) return {statusCode:401,headers,body:JSON.stringify({error:"Sessão inválida. Entre novamente."})};
    const stored = await githubRequest("GET");
    if (event.httpMethod === "GET") return {statusCode:200,headers,body:JSON.stringify({queue:stored.queue})};
    const input = JSON.parse(event.body || "{}");
    let queue = stored.queue;
    if (input.action === "add") {
      const item = input.item || {};
      if (!item.nome || !item.titulo || !item.link || !item.legenda || !item.agendado) {
        return {statusCode:400,headers,body:JSON.stringify({error:"Informe notícia, legenda e data/horário para agendar."})};
      }
      const date = new Date(item.agendado);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        return {statusCode:400,headers,body:JSON.stringify({error:"Escolha uma data e horário futuros."})};
      }
      if (queue.some(q => q.nome === item.nome && ["Aguardando aprovação","Aprovado","Agendado"].includes(q.status))) {
        return {statusCode:409,headers,body:JSON.stringify({error:"Esta notícia já está na fila."})};
      }
      queue.unshift({...item,id:Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8),status:"Aguardando aprovação",criadoEm:new Date().toISOString(),aprovadoPor:null});
    } else if (input.action === "approve") {
      const item = queue.find(q => q.id === input.id);
      if (!item) return {statusCode:404,headers,body:JSON.stringify({error:"Item não encontrado na fila."})};
      if (item.status !== "Aguardando aprovação") return {statusCode:409,headers,body:JSON.stringify({error:"Este item não está aguardando aprovação."})};
      if (new Date(item.agendado).getTime() <= Date.now()) return {statusCode:400,headers,body:JSON.stringify({error:"O horário escolhido já passou. Edite o agendamento."})};
      item.status = "Aprovado";
      item.aprovadoPor = user.email;
      item.aprovadoEm = new Date().toISOString();
    } else if (input.action === "remove") {
      queue = queue.filter(q => q.id !== input.id);
    } else {
      return {statusCode:400,headers,body:JSON.stringify({error:"Ação inválida."})};
    }
    await githubRequest("PUT",stored.sha,queue);
    return {statusCode:200,headers,body:JSON.stringify({ok:true,queue})};
  } catch (error) {
    return {statusCode:500,headers,body:JSON.stringify({error:error.message || "Erro ao atualizar a fila."})};
  }
};
