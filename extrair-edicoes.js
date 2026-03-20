const fs = require("fs");
const path = require("path");

// 📁 pasta de saída
const pasta = path.join(__dirname, "edicoes");

// garante que a pasta existe
if (!fs.existsSync(pasta)) {
  fs.mkdirSync(pasta);
}

// 🧹 limpa arquivos antigos (.md)
fs.readdirSync(pasta).forEach(file => {
  if (file.endsWith(".md")) {
    fs.unlinkSync(path.join(pasta, file));
  }
});

// 📄 lê o HTML
const html = fs.readFileSync("edicoes-impressas.html", "utf-8");

// 🔎 pega link + título
const regex = /<h5 class="card-title"><a href="(.*?)">\s*(.*?)<\/a>/g;

let match;
let count = 0;

while ((match = regex.exec(html)) !== null) {

  const link = match[1].trim();
  const titulo = match[2].trim();

  if (!link || !titulo) continue;

  // 🧠 cria slug limpo
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

  fs.writeFileSync(path.join(pasta, nomeArquivo), conteudo);

  console.log(`✔ Criado: ${nomeArquivo}`);
  count++;
}

console.log(`\n✅ Total de edições extraídas: ${count}`);
