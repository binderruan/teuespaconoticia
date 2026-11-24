const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const raiz = __dirname;
const pasta = path.join(raiz, "noticias");
const modelo = fs.readFileSync(path.join(raiz, "noticia.html"), "utf8");
const arquivos = fs.readdirSync(pasta).filter(a => a.endsWith(".md")).reverse();
fs.writeFileSync(path.join(pasta, "posts.json"), JSON.stringify(arquivos, null, 2));

function escaparHtml(v) {
  return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function lerCampo(conteudo, campo, padrao = "") {
  let valor = (conteudo.match(new RegExp("^" + campo + ":\\s*(.*)$", "mi")) || ["", padrao])[1].trim();
  if (valor.startsWith('"')) { try { valor = JSON.parse(valor); } catch (_) {} }
  else if (valor.startsWith("'") && valor.endsWith("'")) valor = valor.slice(1, -1).replace(/''/g, "'");
  return valor;
}
function urlImagem(valor) {
  if (!valor) return "https://teuespaco.com.br/images/logo.png";
  if (/^https?:\/\//i.test(valor)) return valor;
  return "https://teuespaco.com.br/" + valor.replace(/^\.?\//, "");
}
function descricaoDaMateria(md) {
  return String(md || "").replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ").replace(/[#>*_~]/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
}
function dataRss(data) {
  const p = String(data || "").split("/");
  if (p.length !== 3) return new Date().toUTCString();
  const d = new Date(Date.UTC(Number(p[2]), Number(p[1])-1, Number(p[0]), 12, 0, 0));
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}
const noticias = [];
function nomeDaPagina(nome) {
  const base = nome.replace(/\.md$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const hash = crypto.createHash("sha1").update(nome).digest("hex").slice(0, 10);
  return "materia-" + (base || "noticia") + "-" + hash + ".html";
}
for (const nome of arquivos) {
  const conteudo = fs.readFileSync(path.join(pasta, nome), "utf8");
  const titulo = lerCampo(conteudo, "title", "Sem título");
  const data = lerCampo(conteudo, "date");
  const imagem = urlImagem(lerCampo(conteudo, "thumbnail", "images/logo.png"));
  const categoria = lerCampo(conteudo, "category");
  const descricao = descricaoDaMateria(conteudo);
  const arquivoHtml = nomeDaPagina(nome);
  const urlComPost = "https://teuespaco.com.br/" + arquivoHtml;
  noticias.push({ nome, titulo: titulo.trim(), data: data.trim(), imagem, categoria: categoria.trim() });

  const metas = [
    '<meta name="description" content="' + escaparHtml(descricao) + '">',
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="Rádio e Jornal Teu Espaço">',
    '<meta property="og:title" content="' + escaparHtml(titulo) + '">',
    '<meta property="og:description" content="' + escaparHtml(descricao) + '">',
    '<meta property="og:url" content="' + escaparHtml(urlComPost) + '">',
    '<meta property="og:image" content="' + escaparHtml(imagem) + '" id="og-image">',
    '<meta property="og:image:secure_url" content="' + escaparHtml(imagem) + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + escaparHtml(titulo) + '">',
    '<meta name="twitter:description" content="' + escaparHtml(descricao) + '">',
    '<meta name="twitter:image" content="' + escaparHtml(imagem) + '">',
    '<link rel="canonical" href="' + escaparHtml(urlComPost) + '">'
  ].join("\n    ");
  let pagina = modelo.replace(/<meta property="og:image"[^>]*id="og-image"[^>]*>/i, metas);
  pagina = pagina.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escaparHtml(titulo) + " - Teu Espaço</title>");
  pagina = pagina.replace("</head>", "<script>window.__TEUESPACO_POST_FILE__ = " + JSON.stringify(nome) + ";<\\/script>\n</head>");
  fs.writeFileSync(path.join(raiz, arquivoHtml), pagina, "utf8");
}
fs.writeFileSync(path.join(pasta, "noticias.json"), JSON.stringify(noticias, null, 2));
function escaparXml(v) {
  return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
const itens = [...noticias].sort((a,b) => {
  const conv = v => { const p=String(v||"").split("/"); return p.length===3 ? new Date(Number(p[2]),Number(p[1])-1,Number(p[0])).getTime() : 0; };
  return conv(b.data)-conv(a.data);
}).slice(0,30).map(n => {
  const arquivoHtml = nomeDaPagina(n.nome);
  const link = "https://teuespaco.com.br/" + arquivoHtml;
  const tipoImagem = /\.png(?:\?|$)/i.test(n.imagem) ? "image/png" : /\.webp(?:\?|$)/i.test(n.imagem) ? "image/webp" : "image/jpeg";
  return '    <item>\n      <title>' + escaparXml(n.titulo) + '</title>\n      <link>' + escaparXml(link) + '</link>\n      <guid isPermaLink="true">' + escaparXml(link) + '</guid>\n      <enclosure url="' + escaparXml(n.imagem) + '" type="' + tipoImagem + '" length="0" />\n      <media:content url="' + escaparXml(n.imagem) + '" medium="image" />\n      <pubDate>' + dataRss(n.data) + '</pubDate>\n      <category>' + escaparXml(n.categoria) + '</category>\n    </item>';
}).join("\n");
const rss = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">\n  <channel>\n    <title>Teu Espaço - Notícias</title>\n    <link>https://teuespaco.com.br/noticias</link>\n    <description>Últimas notícias do Rádio e Jornal Teu Espaço</description>\n    <language>pt-br</language>\n    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' + itens + '\n  </channel>\n</rss>\n';
fs.writeFileSync(path.join(raiz, "rss.xml"), rss, "utf8");
console.log("Arquivos, páginas individuais e feed RSS criados!");
