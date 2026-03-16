const fs = require("fs");

const pasta = "edicoes";

// ler todos arquivos
const arquivos = fs.readdirSync(pasta);

// filtrar apenas .md
const edicoes = arquivos.filter(a => a.endsWith(".md"));

// gerar JSON
fs.writeFileSync(
  `${pasta}/edicoes.json`,
  JSON.stringify(edicoes, null, 2)
);

console.log("edicoes.json atualizado!");
