import { XMLParser } from "fast-xml-parser";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const BASE = "https://canoinhas.atende.net";

// Páginas que normalmente dão “conteúdo estático” (sem depender de sessão/JS)
const LIST_CANDIDATES = [
  `${BASE}/cidadao/noticia/rss?output=1`,
  `${BASE}/cidadao/noticia?output=1`,
  `${BASE}/cidadao/noticia/rss`,
  `${BASE}/cidadao/noticia`,
];

const OUT_DIR = path.join(process.cwd(), "noticias");
const POSTS_JSON = path.join(OUT_DIR, "noticias.json"); // ✅ seu arquivo
const IMPORTS_JSON = path.join(OUT_DIR, "_imports_atende.json");

const CRAWL_DELAY_MS = 11000; // robots.txt fala 10s -> uso 11s
const MAX_LINKS_PER_RUN = 12;

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

// fetch com decode de charset + retry + timeout
async function fetchText(url, { retries = 4, timeoutMs = 45000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          // user-agent “real” costuma evitar bloqueios/versões estranhas
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
          "accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
      });

      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);

      const buf = Buffer.from(await res.arrayBuffer());

      // detecta charset no início do HTML/XML
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

function pareceXml(texto) {
  const t = (texto || "").trim().toLowerCase();
  return t.startsWith("<?xml") || t.startsWith("<rss") || t.startsWith("<feed");
}

function cleanAbsUrl(u) {
  if (!u) return null;
  let url = String(u).trim();

  // remove aspas/perfis comuns
  url = url.replace(/^["']|["']$/g, "");

  if (url.startsWith("//")) url = "https:" + url;
  if (url.startsWith("/")) url = `${BASE}${url}`;
  if (!url.startsWith("http")) url = `${BASE}/${url}`;

  // evita pegar a própria lista (/rss) como “notícia”
  if (url.includes("/cidadao/noticia/rss")) return null;

  // garante que é link de notícia
  if (!url.includes("/cidadao/noticia/")) return null;

  return url;
}

async function fetchListPage() {
  let last = "";

  for (const url of LIST_CANDIDATES) {
    const txt = await fetchText(url);
    last = txt;

    console.log("Tentando LISTA:", url);
    console.log("Inicio:", txt.slice(0, 120).replace(/\s+/g, " "));

    // Se for XML, já serve como “lista”
    if (pareceXml(txt)) return { kind: "xml", url, body: txt };

    // Se for HTML, também serve (a gente extrai links)
    // Só evita quando vem a tela de sessão expirada
    if (!txt.toLowerCase().includes("sessão do usuário expirada")) {
      return { kind: "html", url, body: txt };
    }

    console.log("⚠️ Veio tela de sessão expirada nessa URL, tentando outra...");
  }

  console.log("❌ Nenhuma URL de lista funcionou. Último início:", last.slice(0, 200));
  return { kind: "none", url: null, body: null };
}

function extractLinksFromHtml(html) {
  const links = [];
  const $ = cheerio.load(html);

  // 1) href normal
  $("a[href]").each((_, a) => {
    const href = ($(a).attr("href") || "").trim();
    const abs = cleanAbsUrl(href);
    if (abs) links.push(abs);
  });

  // 2) data-href / data-url / onclick
  $("[data-href],[data-url],[onclick]").each((_, el) => {
    const dh = ($(el).attr("data-href") || "").trim();
    const du = ($(el).attr("data-url") || "").trim();
    const oc = ($(el).attr("onclick") || "").trim();

    for (const c of [dh, du, oc]) {
      if (!c) continue;

      const m = c.match(/(https?:\/\/[^\s"'()]+|\/cidadao\/noticia\/[^\s"'()]+)/i);
      const raw = (m?.[1] || "").trim();
      const abs = cleanAbsUrl(raw);
      if (abs) links.push(abs);
    }
  });

  // 3) regex no HTML inteiro (às vezes vem “escondido” em JS/JSON)
  const rx = /(?:https?:\/\/canoinhas\.atende\.net)?\/cidadao\/noticia\/[a-z0-9\-_%]+/gi;
  const found = html.match(rx) || [];
  for (const f of found) {
    const abs = cleanAbsUrl(f);
    if (abs) links.push(abs);
  }

  return [...new Set(links)];
}

function extractLinksFromXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    cdataPropName: "__cdata",
  });

  const obj = parser.parse(xml);

  // RSS2: rss.channel.item
  // Atom: feed.entry
  const items = obj?.rss?.channel?.item || obj?.feed?.entry || [];
  const arr = Array.isArray(items) ? items : [items];

  const links = arr
    .map((it) => {
      // RSS2: <link>...</link>
      if (typeof it?.link === "string") return it.link.trim();
      if (it?.link?.__cdata) return String(it.link.__cdata).trim();

      // RSS2: às vezes usam guid como URL
      if (typeof it?.guid === "string") return it.guid.trim();
      if (it?.guid?.__cdata) return String(it.guid.__cdata).trim();

      // Atom: <link href="..."/>
      if (it?.link?.["@_href"]) return String(it.link["@_href"]).trim();
      if (Array.isArray(it?.link)) {
        const first = it.link.find((x) => x?.["@_href"])?.["@_href"];
        if (first) return String(first).trim();
      }

      return null;
    })
    .map(cleanAbsUrl)
    .filter(Boolean);

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

  // 1) Pega “lista” (XML ou HTML)
  const list = await fetchListPage();
  if (list.kind === "none") {
    console.log("OK: 0 novas notícias importadas (nenhuma lista disponível).");
    return;
  }

  let links = [];
  if (list.kind === "xml") {
    console.log("✅ Lista veio em XML:", list.url);
    console.log("XML (inicio):", list.body.slice(0, 200).replace(/\s+/g, " "));
    links = extractLinksFromXml(list.body);
  } else {
    console.log("✅ Lista veio em HTML:", list.url);
    console.log("HTML (inicio):", list.body.slice(0, 200).replace(/\s+/g, " "));
    links = extractLinksFromHtml(list.body);
  }

  links = links.slice(0, MAX_LINKS_PER_RUN);

  console.log("LINKS ENCONTRADOS:", links.length);
  console.log("PRIMEIROS LINKS:", links.slice(0, 5));

  let novos = 0;

  for (const url of links) {
    if (importedSet.has(url)) continue;

    // tenta versão “output=1” da notícia também (quando existir)
    const urlOutput = url.includes("?") ? `${url}&output=1` : `${url}?output=1`;

    let html = "";
    try {
      html = await fetchText(urlOutput);
      if (html.toLowerCase().includes("sessão do usuário expirada")) {
        html = await fetchText(url); // fallback
      }
    } catch {
      html = await fetchText(url); // fallback
    }

    const $$ = cheerio.load(html);

    const title =
      ($$("h1").first().text() || $$("title").text() || "Notícia").trim();

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
      // fallback: pega o maior bloco
      const candidates = ["main", ".container", ".content", ".conteudo", ".noticia"];
      let best = "";
      for (const sel of candidates) {
        const t = $$(sel).text().trim();
        if (t.length > best.length) best = t;
      }
      content = best || $$.text().trim();
    }

    // evita salvar “vazio”
    if (!content || content.length < 50) {
      console.log("⚠️ Conteúdo muito pequeno, pulando:", url);
      importedSet.add(url); // marca como visto pra não ficar tentando sempre
      await sleep(CRAWL_DELAY_MS);
      continue;
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

    console.log("✅ Importado:", title);
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
