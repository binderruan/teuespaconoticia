const fs = require('fs');
const path = './programacao';

const arquivos = fs.readdirSync(path);

const lista = arquivos.map(file => {
  const conteudo = fs.readFileSync(`${path}/${file}`, 'utf-8');

  return {
    title: conteudo.match(/title:\s*(.*)/)?.[1]?.trim() || "",
    image: conteudo.match(/image:\s*(.*)/)?.[1]?.trim() || "",
    dias: conteudo.match(/dias:\s*(.*)/)?.[1]?.trim() || "",
    horario: conteudo.match(/horario:\s*(.*)/)?.[1]?.trim() || ""
  };
});

fs.writeFileSync('./programacao.json', JSON.stringify(lista, null, 2));
