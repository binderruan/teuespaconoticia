// scripts/import-atende.js
import { XMLParser } from "fast-xml-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const BASE = "https://canoinhas.atende.net";
const SITEMAP_INDEX_URL = `${BASE}/sitemap/sitemap.xml`;

const OUT_DIR = path.join(process.cwd(), "noticias");
const POSTS_JSON = path.join(OUT_DIR, "noticias.json"); // seu arquivo
const IMPORTS_JSON = path.join(OUT_DIR, "_imports_atende.json");

// robots.txt: Crawl-delay: 10
const CRAWL_DELAY_MS = 10_000;

// quantas notícias puxar por execução (pra não pesar)
const MAX_PER_RUN = 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

function slugify(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90);
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function fetchText(url, { retries = 4, timeoutMs = 45000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "teuespaco-bot/1.0 (+https://www.teuespaco.com.br)",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
      });

      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);

      const buf = Buffer.from(await res.arrayBuffer());

      // detecta charset
      const head = buf.slice(0, 5000).toString("ascii");
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
      console.log(`⚠️ Falhou (${attempt}/${retries}) ${url}. Tentando em ${wait}ms...`);
      await sleep(wait);
    }
  }
}

function frontmatter({ title, date, thumbnail, category, source }) {
  const esc = (s) => (s || "").replace(/"/g, '\\"');
  return (
    `---\n` +
    `title: "${esc(title)}"\n` +
    `date: "${esc(date)}"\n` +
    `thumbnail: "${esc(thumbnail)}"\n` +
    `category: "${esc(category)}"\n` +
    `source: "${esc(source)}"\n` +
    `---\n\n`
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function asArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

async function parseSitemapUrlsFromXml(xml) {
  const obj = parser.parse(xml);

  // sitemap index: <sitemapindex><sitemap><loc>...</loc>
  if (obj?.sitemapindex?.sitemap) {
    const maps = asArray(obj.sitemapindex.sitemap)
      .map((s) => s?.loc)
      .filter(Boolean);
    return { type: "index", urls: maps };
  }

  // url set: <urlset><url><loc>...</loc>
  if (obj?.urlset?.url) {
    const urls = asArray(obj.urlset.url)
      .map((u) => u?.loc)
      .filter(Boolean);
    return { type: "urlset", urls };
  }

  return { type: "unknown", urls: [] };
}

async function getAllNewsLinksViaSitemap() {
  console.log("SITEMAP INDEX:", SITEMAP_INDEX_URL);

  const indexXml = await fetchText(SITEMAP_INDEX_URL);
  const indexParsed = await parseSitemapUrlsFromXml(indexXml);

  let allUrls = [];

  if (indexParsed.type === "index") {
    // varre sitemaps do índice
    for (const smUrl of indexParsed.urls) {
      // opcional: só baixa sitemaps que parecem conter "noticia"
      // (se quiser mais amplo, remove esse if)
      if (!String(smUrl).includes("noticia") && !String(smUrl).includes("not")) {
        continue;
      }

      console.log("Baixando sitemap:", smUrl);
      const smXml = await fetchText(smUrl);
      const smParsed = await parseSitemapUrlsFromXml(smXml);

      if (smParsed.type === "urlset") {
        allUrls.push(...smParsed.urls);
      }

      // respeita crawl-delay também no sitemap
      await sleep(CRAWL_DELAY_MS);
    }
  } else if (indexParsed.type === "urlset") {
    allUrls = indexParsed.urls;
  }

  // filtra URLs que são notícias
  const news = allUrls
    .map((u) => String(u).trim())
    .filter(Boolean)
    .filter((u) => u.includes("/cidadao/noticia/"))
    .filter((u) => !u.endsWith("/rss"))
    .filter((u) => !u.includes("?output="));

  // remove duplicados
  return [...new Set(news)];
}

function extractDateFromPage($$) {
  // tenta achar algo tipo "11/02/2026 09:04:53"
  const txt = $$("body").text();
  const m = txt.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  if (m?.[1]) return m[1];
  return new Date().toLocaleDateString("pt-BR");
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const postsList = loadJson(POSTS_JSON, []);
  const imported = loadJson(IMPORTS_JSON, { urls: [] });
  const importedSet = new Set(imported.urls || []);

  const linksAll = await getAllNewsLinksViaSitemap();
  console.log("TOTAL LINKS NOTÍCIA NO SITEMAP:", linksAll.length);

  // pega só as mais recentes (normalmente sitemap já vem “meio ordenado”, mas não garantido)
  const links = linksAll.slice(0, 60);

  let novos = 0;

  for (const url of links) {
    if (novos >= MAX_PER_RUN) break;
    if (importedSet.has(url)) continue;

    console.log("Importando:", url);

    const html = await fetchText(url);
    const $$ = cheerio.load(html);

    const title =
      ($$("h1").first().text() ||
        $$("title").text() ||
        "Notícia").trim();

    const date = extractDateFromPage($$);

    let thumbnail =
      $$('meta[property="og:image"]').attr("content") ||
      $$("article img").first().attr("src") ||
      $$("img").first().attr("src") ||
      "";
    if (thumbnail && thumbnail.startsWith("/")) thumbnail = `${BASE}${thumbnail}`;

    // conteúdo: tenta um container de notícia
    let content = "";
    const candidates = ["article", ".noticia", ".conteudo", "main", ".container"];
    let best = "";
    for (const sel of candidates) {
      const el = $$(sel).first();
      if (!el.length) continue;
      el.find("script, style, noscript").remove();
      const t = el.text().trim();
      if (t.length > best.length) best = t;
    }
    content = best || $$("body").text().trim();

    // monta arquivo
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

    // robots.txt: crawl-delay 10
    await sleep(CRAWL_DELAY_MS);
  }

  saveJson(POSTS_JSON, [...new Set(postsList)]);
  saveJson(IMPORTS_JSON, { urls: [...importedSet] });

  console.log(`OK: ${novos} novas notícias importadas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
