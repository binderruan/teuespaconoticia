const fs = require("fs");

const manter = [
"CAPA FACEBOOK",
"admin",
"assets",
"casamento",
"images",
"logo",
"player",
"site",
"noticias",
"index.html",
"index.php",
"gerar-posts.js",
"edicoes-impressas.html",
"programacao.html",
".git"
];

const arquivos = fs.readdirSync("./");

arquivos.forEach(item => {

if(!manter.includes(item)){

fs.rmSync(item, { recursive: true, force: true });
console.log("Removido:", item);

}

});

console.log("Limpeza concluída");
