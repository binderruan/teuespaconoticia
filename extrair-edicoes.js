const fs = require("fs");

// 👇 aqui está o nome correto do seu arquivo
const html = fs.readFileSync("edicoes-impressas.html", "utf-8");

const regex = /<h5 class="card-title"><a href="(.*?)">\s*(.*?)<\/a>/g;

let match;
let count = 1;

while ((match = regex.exec(html)) !== null) {

  const link = match[1].trim();
  const titulo = match[2].trim();

  if(!link || !titulo) continue;

  const slug = titulo
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const nomeArquivo = `${slug}.md`;

  const conteudo = `---
titulo: ${titulo}
link: ${link}
---
`;

  fs.writeFileSync(`edicoes/${nomeArquivo}`, conteudo);

  console.log(`✔ Criado: ${nomeArquivo}`);
  count++;
}

console.log(`\n✅ Total de edições extraídas: ${count-1}`);
