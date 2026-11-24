const SITE_URL = "https://teuespaco.com.br";
const crypto = require("crypto");

function linkDaNoticia(nome) {
  const base = String(nome || "").replace(/\\.md$/i, "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const hash = crypto.createHash("sha1").update(String(nome || "")).digest("hex").slice(0, 10);
  return SITE_URL + "/materia-" + (base || "noticia") + "-" + hash + ".html";
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido." }) };
  }

  const authorization = event.headers.authorization || event.headers.Authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Faça login para acessar o painel." }) };
  }

  try {
    const identityResponse = await fetch(SITE_URL + "/.netlify/identity/user", {
      headers: { Authorization: authorization }
    });

    if (!identityResponse.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Sessão inválida ou expirada. Entre novamente." }) };
    }

    const user = await identityResponse.json();
    if (!user || !user.email) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Não foi possível validar o usuário." }) };
    }

    const newsResponse = await fetch(SITE_URL + "/noticias/noticias.json", {
      headers: { Accept: "application/json" }
    });

    if (!newsResponse.ok) throw new Error("Não foi possível carregar o catálogo de notícias.");

    const news = await newsResponse.json();
    if (!Array.isArray(news)) throw new Error("O catálogo de notícias está em formato inválido.");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        user: { email: user.email },
        total: news.length,
        noticias: news.map(item => ({
          nome: item.nome || "",
          titulo: item.titulo || "Sem título",
          data: item.data || "",
          imagem: item.imagem || "",
          categoria: item.categoria || "",
          link: linkDaNoticia(item.nome)
        }))
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Erro interno ao carregar o painel." })
    };
  }
};
