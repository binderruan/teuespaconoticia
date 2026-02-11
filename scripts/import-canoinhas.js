import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";

const LIST_URL = "https://canoinhas.atende.net/cidadao/noticia";
const OUT_DIR = path.join(process.cwd(), "noticias");
const POSTS_JSON = path.join(OUT_DIR, "posts.json");

// util
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

function slugify(str) {
  return str
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function loadPostsList() {
  if (!fs.existsSync(POSTS_JSON)) return [];
  return JSON.parse(fs.readFileSync(POSTS_JSON, "utf8"));
}

function savePostsList(list) {
  fs.writeFileSync(POSTS_JSON, JSON.stringify(list, null, 2));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "teuespaco-bot/1.0 (+https://teuespaco.com.br)",
      "accept-language": "pt-BR,pt;q=0.9",
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return await res.text();
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const existing = new Set(loadPostsList());

  // 1) pega lista
  const listHtml = await fetchHtml(LIST_URL);
  const $ = cheerio.load(listHtml);

  // ⚠️ AJUSTE O SELETOR:
  // Aqui você precisa inspecionar o HTML da página de lista do Atende.net e trocar pelo seletor correto.
  // Exemplo comum: links dentro de cards/lista:
  const links = [];
  $("a").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    // pega apenas links de notícia
    if (href.includes("/cidadao/noticia/")) {
      const abs = href.startsWith("http") ? href : `https://canoinhas.atende.net${href}`;
      links.push(abs);
    }
  });

  // remove duplicados
  const uniqueLinks = [...new Set(links)].slice(0, 10); // pega só as 10 mais recentes (ajustável)

  let newCount = 0;

  for (const url of uniqueLinks) {
    const id = sha1(url);
    // evita baixar de novo usando um "fingerprint" no nome do arquivo
    // (ou você pode manter um banco/arquivo de urls importadas)
    const articleHtml = await fetchHtml(url);
    const $$ = cheerio.load(articleHtml);

    // ⚠️ AJUSTE OS SELETORES DO DETALHE:
    // (você vai ajustar com o “Inspecionar” no navegador)
    const title = ($$("h1").first().text() || "Notícia").trim();
    const dateText = ($$("[datetime], time").first().text() || "").trim();

    // tenta achar imagem principal
    let img = $$("img").first().attr("src") || "";
    if (img && img.startsWith("/")) img = `https://canoinhas.atende.net${img}`;

    // corpo (exemplo: pega o container principal do texto)
    const contentEl = $$("article, .conteudo, .noticia, .content").first();
    const contentText = contentEl.text().trim();

    // monta markdown (melhor: criar resumo + link)
    const fonte = url;

    const slug = slugify(title).slice(0, 80) || `noticia-${id}`;
    const filename = `${slug}-${id}.md`;
    const filePath = path.join(OUT_DIR, filename);

    if (fs.existsSync(filePath)) continue;

    const md = `---
title: "${title.replace(/"/g, '\\"')}"
date: "${new Date().toLocaleDateString("pt-BR")}"
thumbnail: "${img || ""}"
category: "Canoinhas (Atende.net)"
source: "${fonte}"
---

> Fonte: ${fonte}

${contentText}
`;

    fs.writeFileSync(filePath, md, "utf8");
    existing.add(filename);
    newCount++;

    // evita “martelar” o site
    await sleep(800);
  }

  // atualiza posts.json (ordem: mais novos primeiro)
  const finalList = Array.from(existing);
  savePostsList(finalList);

  console.log(`Importação OK. Novas: ${newCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
