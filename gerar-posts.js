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

 const titulo = (conteudo.match(/title:\s*(.*)/i)||["","Sem título"])[1];
 const data = (conteudo.match(/date:\s*(.*)/i)||["",""])[1];
 const imagem = (conteudo.match(/thumbnail:\s*(.*)/i)||["","images/logo.png"])[1];
 const categoria = (conteudo.match(/category:\s*(.*)/i)||["",""])[1];

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
