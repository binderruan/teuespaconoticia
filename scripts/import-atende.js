import { XMLParser } from "fast-xml-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const BASE = "https://canoinhas.atende.net";
const LIST_URL = `${BASE}/cidadao/noticia`;

const OUT_DIR = path.join(process.cwd(), "noticias");
const POSTS_JSON = path.join(OUT_DIR, "noticias.json"); // seu arquivo
const IMPORTS_JSON = path.join(OUT_DIR, "_imports_atende.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

function slugify(str) {
  return (str || "")
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
      console.log(`⚠️ Falhou (${attempt}/${retries}) ${url}. Tentando em ${wait}ms...`);
      await sleep(wait);
    }
  }
}

function acharRssNoHtml(html) {
  // <link rel="alternate" type="application/rss+xml" href="...">
  const m = html.match(
    /<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i
  );
  if (!m) return null;

  let href = (m[1] || "").trim();
  if (!href) return null;

  if (href.startsWith("//")) href = "https:" + href;
  if (href.startsWith("/")) href = `${BASE}${href}`;
  if (!href.startsWith("http")) href = `${BASE}/${href}`;
  return href;
}

async function linksViaRss(rssUrl) {
  const xml = await fetchHtmlRobusto(rssUrl, { timeoutMs: 45000, retries: 4 });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  const obj = parser.parse(xml);

  const items = obj?.rss?.channel?.item || obj?.feed?.entry || [];
  const arr = Array.isArray(items) ? items : [items];

  const links = arr
    .map((it) => {
      if (typeof it?.link === "string") return it.link;        // RSS2
      if (it?.link?.["@_href"]) return it.link["@_href"];      // Atom
      if (Array.isArray(it?.link)) {
        const first = it.link.find((x) => x?.["@_href"])?.["@_href"];
        if (first) return first;
      }
      return null;
    })
    .filter(Boolean)
    .map((u) => {
      if (u.startsWith("//")) return "https:" + u;
      if (u.startsWith("/")) return `${BASE}${u}`;
      if (!u.startsWith("http")) return `${BASE}/${u}`;
      return u;
    });

  return [...new Set(links)];
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

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const postsList = loadJson(POSTS_JSON, []);
  const imported = loadJson(IMPORTS_JSON, { urls: [] });
  const importedSet = new Set(imported.urls || []);

  // 1) Lista de notícias
  const listHtml = await fetchHtmlRobusto(LIST_URL);
  console.log("HTML LISTA (inicio):", listHtml.slice(0, 300));

  const $ = cheerio.load(listHtml);

  let links = [];

  // 1) tenta RSS primeiro
  const rssUrl = acharRssNoHtml(listHtml);
  if (rssUrl) {
    console.log("RSS encontrado:", rssUrl);
    try {
      links = await linksViaRss(rssUrl);
    } catch (e) {
      console.log("Falha ao ler RSS, voltando pro HTML:", e?.message || e);
    }
  } else {
    console.log("RSS não encontrado no HTML.");
  }

  // 2) fallback HTML
  if (links.length === 0) {
    $("a[href]").each((_, a) => {
      const href = ($(a).attr("href") || "").trim();
      if (!href) return;

      if (href.includes("cidadao/noticia/")) {
        const abs = href.startsWith("http")
          ? href
          : href.startsWith("/")
            ? `${BASE}${href}`
            : `${BASE}/${href}`;
        links.push(abs);
      }
    });

    // fallback regex no HTML inteiro
    const rx =
      /(?:https?:\/\/canoinhas\.atende\.net)?\/?cidadao\/noticia\/[a-z0-9\-_%]+/gi;
    const found = listHtml.match(rx) || [];
    for (const f of found) {
      const abs = f.startsWith("http")
        ? f
        : f.startsWith("/")
          ? `${BASE}${f}`
          : `${BASE}/${f}`;
      links.push(abs);
    }

    links = [...new Set(links)];
  }

  links = links.slice(0, 20);
  console.log("LINKS ENCONTRADOS:", links.length);
  console.log("PRIMEIROS LINKS:", links.slice(0, 5));

  let novos = 0;

  for (const url of links) {
    if (importedSet.has(url)) {
      console.log("PULANDO (já importado):", url);
      continue;
    }

    const html = await fetchHtmlRobusto(url);
    const $$ = cheerio.load(html);

    const title = ($$("h1").first().text() || $$("title").text() || "Notícia").trim();

    let date =
      $$("time").first().text().trim() ||
      $$("[datetime]").first().attr("datetime") ||
      "";
    if (!date) date = new Date().toLocaleDateString("pt-BR");

    let thumbnail =
      $$('meta[property="og:image"]').attr("content") ||
      $$("article img").first().attr("src") ||
      $$("img").first().attr("src") ||
      "";
    if (thumbnail && thumbnail.startsWith("/")) thumbnail = `${BASE}${thumbnail}`;

    let content = "";
    const article = $$("article").first();
    if (article.length) {
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

  const finalPosts = [...new Set(postsList)];
  saveJson(POSTS_JSON, finalPosts);

  saveJson(IMPORTS_JSON, { urls: [...importedSet] });

  console.log(`OK: ${novos} novas notícias importadas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
