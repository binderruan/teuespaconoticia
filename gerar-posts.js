const fs = require("fs");
const path = require("path");

const pasta = path.join(__dirname, "noticias");
const arquivos = fs.readdirSync(pasta)
  .filter(a => a.endsWith(".md"))
  .reverse();

fs.writeFileSync(
  path.join(pasta, "posts.json"),
  JSON.stringify(arquivos)
);

console.log("posts.json criado com sucesso!");
