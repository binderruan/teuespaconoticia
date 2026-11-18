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
