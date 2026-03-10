const fs = require("fs");
const path = require("path");

const pasta = "./edicoes";

const arquivos = fs.readdirSync(pasta)
  .filter(file => file.endsWith(".md"));

fs.writeFileSync(
  path.join(pasta, "edicoes.json"),
  JSON.stringify(arquivos, null, 2)
);

console.log("edicoes.json gerado com sucesso!");
