import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const BASE = "https://canoinhas.atende.net";
const LIST_URL = `${BASE}/cidadao/noticia`;

const OUT_DIR = path.join(process.cwd(), "noticias");
const POSTS_JSON = path.join(OUT_DIR, "noticias.json");
const IMPORTS_JSON = path.join(OUT_DIR, "_imports_atende.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

function slugify(str) {
  return str
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90);
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function fetchHtmlRobusto(url, { retries = 3, timeoutMs = 30000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
          "accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
          "cache-control": "no-cache",
          "pragma": "no-cache",
        },
      });

      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);

      const buf = Buffer.from(await res.arrayBuffer());

      const head = buf.slice(0, 4000).toString("ascii");
      const m =
        head.match(/charset=["']?([\w-]+)["']?/i) ||
        head.match(/content=["'][^"']*charset=([\w-]+)[^"']*["']/i);

      const charset = (m?.[1] || "utf-8").toLowerCase();

      try {
        return iconv.decode(buf, charset);
      } catch {
        return iconv.decode(buf, "utf-8");
      }
    } catch (err) {
      clearTimeout(t);
      if (attempt === retries) throw err;

      const wait = 2000 * attempt;
      console.log(
        `⚠️ Falhou (${attempt}/${retries}) ${url}. Tentando em ${wait}ms...`
      );
      await sleep(wait);
    }
  }
}

function frontmatter({ title, date, thumbnail, category, source }) {
  const esc = (s) => (s || "").replace(/"/g, '\\"');
  return `---\n` +
    `title: "${esc(title)}"\n` +
    `date: "${esc(date)}"\n` +
    `thumbnail: "${esc(thumbnail)}"\n` +
    `category: "${esc(category)}"\n` +
    `source: "${esc(source)}"\n` +
    `---\n\n`;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const postsList = loadJson(POSTS_JSON, []);
  const imported = loadJson(IMPORTS_JSON, { urls: [] });
  const importedSet = new Set(imported.urls);

  // 1) Lista de notícias
  const listHtml = await fetchHtmlRobusto(LIST_URL);
  const $ = cheerio.load(listHtml);

  // ✅ tenta achar links de notícia (bem tolerante)
  let links = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    if (href.includes("/cidadao/noticia/")) {
      const abs = href.startsWith("http") ? href : `${BASE}${href}`;
      links.push(abs);
    }
  });

  links = [...new Set(links)].slice(0, 12); // pega as mais recentes

  let novos = 0;

  for (const url of links) {
    if (importedSet.has(url)) continue;

    const html = await fetchHtmlRobusto(url);
    const $$ = cheerio.load(html);

    // 2) Extrair título
    const title =
      ($$("h1").first().text() || $$("title").text() || "Notícia").trim();

    // 3) Data (se não achar, usa hoje pt-BR)
    let date =
      $$("time").first().text().trim() ||
      $$("[datetime]").first().attr("datetime") ||
      "";
    if (!date) date = new Date().toLocaleDateString("pt-BR");

    // 4) Imagem principal (tenta og:image primeiro)
    let thumbnail =
      $$('meta[property="og:image"]').attr("content") ||
      $$("article img").first().attr("src") ||
      $$("img").first().attr("src") ||
      "";
    if (thumbnail && thumbnail.startsWith("/")) thumbnail = `${BASE}${thumbnail}`;

    // 5) Conteúdo: tenta pegar um “article”; se falhar, pega o maior bloco de texto
    let content = "";
    const article = $$("article").first();
    if (article.length) {
      // remove coisas que atrapalham
      article.find("script, style, noscript").remove();
      content = article.text().trim();
    } else {
      const candidates = ["main", ".container", ".content", ".conteudo", ".noticia"];
      let best = "";
      for (const sel of candidates) {
        const t = $$(sel).text().trim();
        if (t.length > best.length) best = t;
      }
      content = best || $$.text().trim();
    }

    // (opcional) limitar tamanho pra não virar “textão” e evitar copyright
    // content = content.slice(0, 2500) + "\n\n(continua na fonte)";

    const id = sha1(url);
    const slug = slugify(title) || `noticia-${id}`;
    const filename = `${slug}-${id}.md`;
    const filepath = path.join(OUT_DIR, filename);

    const md =
      frontmatter({
        title,
        date,
        thumbnail,
        category: "Canoinhas (Atende.net)",
        source: url,
      }) +
      `> Fonte: ${url}\n\n` +
      content +
      `\n`;

    fs.writeFileSync(filepath, md, "utf8");

    postsList.unshift(filename);
    importedSet.add(url);
    novos++;

    await sleep(900);
  }

  // remove duplicados no posts.json
  const finalPosts = [...new Set(postsList)];
  saveJson(POSTS_JSON, finalPosts);

  imported.urls = [...importedSet];
  saveJson(IMPORTS_JSON, imported);

  console.log(`OK: ${novos} novas notícias importadas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
