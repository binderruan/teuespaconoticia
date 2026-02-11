// scripts/import-atende.js
import { XMLParser } from "fast-xml-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const BASE = "https://canoinhas.atende.net";

// tenta várias rotas porque às vezes o servidor devolve HTML no /rss
const RSS_CANDIDATES = [
  `${BASE}/cidadao/noticia/rss?output=1`,
  `${BASE}/cidadao/noticia/rss`,
  `${BASE}/cidadao/noticia?output=1`,
];

const OUT_DIR = path.join(process.cwd(), "noticias");
const POSTS_JSON = path.join(OUT_DIR, "noticias.json"); // seu arquivo de lista
const IMPORTS_JSON = path.join(OUT_DIR, "_imports_atende.json"); // controla o que já foi importado

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
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
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

      // detecta charset (o Atende costuma ser iso-8859-1)
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

function pareceXml(texto) {
  const t = (texto || "").trim().toLowerCase();
  return t.startsWith("<?xml") || t.startsWith("<rss") || t.startsWith("<feed");
}

async function fetchRssXml() {
  let last = "";

  for (const url of RSS_CANDIDATES) {
    const txt = await fetchText(url);
    last = txt;

    console.log("Tentando RSS:", url);
    console.log("Inicio:", txt.slice(0, 80).replace(/\s+/g, " "));

    if (pareceXml(txt)) {
      console.log("✅ RSS OK:", url);
      return { xml: txt, url };
    }
  }

  console.log("❌ Nenhuma URL retornou XML. Último início:", last.slice(0, 200));
  return { xml: null, url: null };
}

function parseDateFromRssItem(it) {
  // tenta pubDate (RSS2) ou updated/published (Atom)
  const raw =
    (typeof it?.pubDate === "string" && it.pubDate) ||
    (typeof it?.published === "string" && it.published) ||
    (typeof it?.updated === "string" && it.updated) ||
    (it?.pubDate?.__cdata ? String(it.pubDate.__cdata) : "") ||
    "";

  const d = raw ? new Date(raw) : null;
  if (d && !isNaN(d.getTime())) return d.toLocaleDateString("pt-BR");

  return ""; // vazio = cai pro "hoje" mais abaixo
}

function pickLinkFromItem(it) {
  // RSS2: <link>...</link>
  if (typeof it?.link === "string") return it.link.trim();
  if (it?.link?.__cdata) return String(it.link.__cdata).trim();

  // RSS2: <guid>...</guid>
  if (typeof it?.guid === "string") return it.guid.trim();
  if (it?.guid?.__cdata) return String(it.guid.__cdata).trim();

  // Atom: <link href="..."/>
  if (it?.link?.["@_href"]) return String(it.link["@_href"]).trim();
  if (Array.isArray(it?.link)) {
    const first = it.link.find((x) => x?.["@_href"])?.["@_href"];
    if (first) return String(first).trim();
  }

  return null;
}

async function getRssItems() {
  const { xml, url } = await fetchRssXml();
  if (!xml) return { rssUrl: null, items: [] };

  console.log("RSS usado:", url);
  console.log("RSS (inicio):", xml.slice(0, 220));

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    cdataPropName: "__cdata",
  });

  const obj = parser.parse(xml);

  const items = obj?.rss?.channel?.item || obj?.feed?.entry || [];
  const arr = Array.isArray(items) ? items : [items];

  return { rssUrl: url, items: arr.filter(Boolean) };
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

function normalizaUrl(u) {
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return `${BASE}${u}`;
  if (!u.startsWith("http")) return `${BASE}/${u}`;
  return u;
}

// Extrai conteúdo do HTML da notícia (tolerante)
function extrairConteudo($$) {
  // remove coisas inúteis
  $$("script, style, noscript").remove();

  // tenta algo mais “article-like”
  const article = $$("article").first();
  if (article.length) return article.text().trim();

  const main = $$("main").first();
  if (main.length) return main.text().trim();

  // tenta blocos comuns
  const candidates = [
    ".conteudo",
    ".content",
    ".noticia",
    ".container",
    "#conteudo",
    "#content",
  ];
  let best = "";
  for (const sel of candidates) {
    const t = $$(sel).first().text().trim();
    if (t.length > best.length) best = t;
  }
  if (best) return best;

  return $$.text().trim();
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const postsList = loadJson(POSTS_JSON, []);
  const imported = loadJson(IMPORTS_JSON, { urls: [] });
  const importedSet = new Set(imported.urls || []);

  console.log("RSS candidates:", RSS_CANDIDATES);

  // pega itens do RSS e já limita a quantidade por execução
  const { items } = await getRssItems();
  console.log("Itens RSS:", items.length);

  // monta lista de links + data vinda do RSS
  const rows = items
    .map((it) => {
      const link = normalizaUrl(pickLinkFromItem(it));
      if (!link) return null;
      const date = parseDateFromRssItem(it); // DD/MM/YYYY ou ""
      return { link, date };
    })
    .filter(Boolean);

  // remove duplicados e limita
  const unique = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.link)) continue;
    seen.add(r.link);
    unique.push(r);
  }

  const batch = unique.slice(0, 20);

  console.log("LINKS ENCONTRADOS:", batch.length);
  console.log("PRIMEIROS LINKS:", batch.slice(0, 5).map((x) => x.link));

  let novos = 0;

  for (const { link: url, date: dateFromRss } of batch) {
    if (importedSet.has(url)) {
      console.log("PULANDO (já importado):", url);
      continue;
    }

    const html = await fetchText(url);
    const $$ = cheerio.load(html);

    const title =
      ($$("h1").first().text() || $$("title").text() || "Notícia").trim();

    // data: prioriza RSS, senão tenta html, senão hoje
    let date =
      dateFromRss ||
      $$("time")
