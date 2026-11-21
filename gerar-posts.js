const fs = require("fs");
const path = require("path");

const pasta = path.join(__dirname, "noticias");

const arquivos = fs.readdirSync(pasta)
.filter(a => a.endsWith(".md"))
.reverse();

fs.writeFileSync(
 path.join(pasta,"posts.json"),
 JSON.stringify(arquivos,null,2)
);

let noticias = [];

arquivos.forEach(nome => {

 const conteudo = fs.readFileSync(
   path.join(pasta,nome),
   "utf8"
 );

 const lerCampo = (campo, padrao = "") => {
   let valor = (conteudo.match(new RegExp("^" + campo + ":\\s*(.*)$", "mi")) || ["", padrao])[1].trim();
   if (valor.startsWith('"')) {
     try { valor = JSON.parse(valor); } catch (_) {}
   } else if (valor.startsWith("'") && valor.endsWith("'")) {
     valor = valor.slice(1, -1).replace(/''/g, "'");
   }
   return valor;
 };

 const titulo = lerCampo("title", "Sem título");
 const data = lerCampo("date");
 const imagem = lerCampo("thumbnail", "images/logo.png");
 const categoria = lerCampo("category");

 noticias.push({
   nome,
   titulo: titulo.trim(),
   data: data.trim(),
   imagem: imagem.trim(),
   categoria: categoria.trim()
 });

});

fs.writeFileSync(
 path.join(pasta,"noticias.json"),
 JSON.stringify(noticias,null,2)
);

console.log("Arquivos criados!");

function escaparXml(valor) {
 return String(valor || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function dataRss(data) {
 const partes = String(data || "").split("/");
 if (partes.length !== 3) return new Date().toUTCString();
 const [dia, mes, ano] = partes;
 const dataObj = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia), 12, 0, 0));
 return Number.isNaN(dataObj.getTime()) ? new Date().toUTCString() : dataObj.toUTCString();
}

const itensRss = [...noticias]
 .sort((a, b) => {
   const converter = valor => {
     const p = String(valor || "").split("/");
     return p.length === 3 ? new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0])).getTime() : 0;
   };
   return converter(b.data) - converter(a.data);
 })
 .slice(0, 30)
 .map(noticia => {
   const link = "https://teuespaco.com.br/noticia.html?post=" + encodeURIComponent(noticia.nome);
   const titulo = escaparXml(noticia.titulo);
   const categoria = escaparXml(noticia.categoria);
   return `    <item>
      <title>${titulo}</title>
      <link>${escaparXml(link)}</link>
      <guid isPermaLink="true">${escaparXml(link)}</guid>
      <pubDate>${dataRss(noticia.data)}</pubDate>
      <category>${categoria}</category>
    </item>`;
 }).join("\n");

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Teu Espaço - Notícias</title>
    <link>https://teuespaco.com.br/noticias</link>
    <description>Últimas notícias do Rádio e Jornal Teu Espaço</description>
    <language>pt-br</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itensRss}
  </channel>
</rss>
`;

fs.writeFileSync(path.join(__dirname, "rss.xml"), rss, "utf8");
console.log("Feed RSS criado!");

