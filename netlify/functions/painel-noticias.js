const SITE_URL = "https://teuespaco.com.br";

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

    const newsResponse = await fetch(SITE_URL + "/noticias.json", {
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
          link: "https://teuespaco.com.br/noticia.html?post=" + encodeURIComponent(item.nome || "")
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
