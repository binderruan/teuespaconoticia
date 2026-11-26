const fs = require("fs");
const path = require("path");

const FEED_URL = "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml";
const NEWS_DIR = path.join(__dirname, "noticias");
const MAX_AGE_HOURS = 168;
const SCHEDULE_STATE = path.join(NEWS_DIR, "agencia-brasil-horarios.json");
const SCHEDULE_HOURS = [8, 12, 17];

function localParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" });
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type,x.value]));
  return { day: p.year+"-"+p.month+"-"+p.day, hour:Number(p.hour), minute:Number(p.minute) };
}

function scheduledSlot() {
  if (process.env.GITHUB_EVENT_NAME !== "schedule") return null;
  const t = localParts();
  const mins = t.hour*60+t.minute;
  return SCHEDULE_HOURS.filter(h => mins >= h*60 && mins-h*60 <= 60).sort((a,b)=>b-a)[0] || null;
}

function decodeEntities(value = "") {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
  if (!match) return "";
  return decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim());
}

function cleanText(value = "") {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function findDivByClass(html, className) {
  const openTag = /<div\b[^>]*>/ig;
  let match;
  while ((match = openTag.exec(html))) {
    const classes = (match[0].match(/\bclass=["']([^"']*)["']/i) || [,""])[1].split(/\s+/);
    if (!classes.includes(className)) continue;

    let depth = 1;
    const token = /<\/?div\b[^>]*>/ig;
    token.lastIndex = openTag.lastIndex;
    let next;
    while ((next = token.exec(html))) {
      if (/^<\/div/i.test(next[0])) depth--;
      else if (!/\/>$/.test(next[0])) depth++;
      if (depth === 0) return html.slice(openTag.lastIndex, next.index);
    }
  }
  return "";
}

function htmlToMarkdown(html) {
  let value = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|iframe|svg|form|button)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(img|picture|source)\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n\n> $1\n\n")
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n* $1")
    .replace(/<\/(p|div|ul|ol|figure|figcaption|section)>/gi, "\n\n")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = cleanText(label);
      return text ? "[" + text + "](" + decodeEntities(href) + ")" : "";
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "$2")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<[^>]+>/g, " ");
  value = decodeEntities(value)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return value
    .replace(/\[(Siga|Acompanhe)[^\]]*\]\([^)]*\)/gi, "")
    .replace(/(Leia também|Mais notícias|Compartilhe esta notícia)[\s\S]*$/i, "")
    .trim();
}

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}

function saoPauloDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric"
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type).value;
  return { display: get("day") + "/" + get("month") + "/" + get("year"),
    file: get("year") + "-" + get("month") + "-" + get("day") };
}

function existingNews() {
  const files = fs.readdirSync(NEWS_DIR).filter(name => name.endsWith(".md"));
  const titles = new Set();
  const urls = new Set();
  for (const name of files) {
    const content = fs.readFileSync(path.join(NEWS_DIR, name), "utf8");
    const title = (content.match(/^title:\s*["']?(.+?)["']?\s*$/mi) || [,""])[1];
    if (title) titles.add(cleanText(title).toLowerCase());
    for (const match of content.matchAll(/https?:\/\/agenciabrasil\.ebc\.com\.br\/[^\s)>"']+/g)) {
      urls.add(match[0].replace(/[.,;]+$/, ""));
    }
  }
  return { titles, urls };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "TeuEspacoNoticias/1.0 (jornalismo; contato: teuespaco.com.br)" }
  });
  if (!response.ok) throw new Error("Falha ao acessar " + url + ": HTTP " + response.status);
  return response.text();
}

async function main() {
  fs.mkdirSync(NEWS_DIR, { recursive: true });
  const rss = await fetchText(FEED_URL);
  const items = [...rss.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(match => match[1]);
  if (!items.length) throw new Error("O feed da Agência Brasil não retornou notícias.");

  const known = existingNews();
  const now = Date.now();
  const parsed = items.map(item => {
    const linkRaw = tagValue(item, "link") || tagValue(item, "guid");
    let link = linkRaw;
    try { link = new URL(linkRaw, "https://agenciabrasil.ebc.com.br").href; } catch (_) {}
    return {
      title: tagValue(item, "title").replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, ""),
      link,
      description: tagValue(item, "description"),
      category: tagValue(item, "category") || "Geral",
      pubDate: tagValue(item, "pubDate") || tagValue(item, "dc:date")
    };
  });
  console.log("Itens RSS encontrados: " + items.length);
  console.log("Primeiro item interpretado: " + JSON.stringify(parsed[0] || {}));
  const candidates = parsed.filter(item => {
    const timestamp = Date.parse(item.pubDate);
    const age = (now - timestamp) / 3600000;
    return item.title && item.link && item.link.startsWith("https://agenciabrasil.ebc.com.br/")
      && Number.isFinite(timestamp) && age >= -1 && age <= MAX_AGE_HOURS
      && !/^parceiros$/i.test(item.category)
      && !known.urls.has(item.link.replace(/[.,;]+$/, ""))
      && !known.titles.has(item.title.toLowerCase());
  }).sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  console.log("Notícias que passaram pelos filtros: " + candidates.length);

  let publicadas = 0;
  const arquivosCriados = [];
  const limitePorExecucao = 3;

  for (const item of candidates) {
    if (publicadas >= limitePorExecucao) break;
    try {
      const html = await fetchText(item.link);
      const lower = html.toLowerCase();
      const prohibited = [
        "é proibida a reprodução deste conteúdo",
        "a republicação de matérias e imagens de parceiros é proibida",
        "republicação de matérias e imagens de parceiros é proibida"
      ];
      if (prohibited.some(term => lower.includes(term))) {
        console.log("Ignorando conteúdo com restrição explícita: " + item.title);
        continue;
      }

      const bodyHtml = findDivByClass(html, "conteudo-noticia")
        || findDivByClass(html, "field--name-body")
        || findDivByClass(html, "article-body")
        || findDivByClass(html, "node__content")
        || item.description;
      const body = htmlToMarkdown(bodyHtml);
      if (body.length < 250) {
        console.log("Ignorando matéria sem corpo textual identificável: " + item.title);
        continue;
      }

      const image = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
        || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
        || [,""])[1];
      if (!image || !/^https?:\/\//i.test(image)) {
        console.log("Ignorando matéria sem imagem principal identificável: " + item.title);
        continue;
      }

      const date = saoPauloDate();
      const category = item.category.replace(/[\r\n"]/g, " ").trim() || "Geral";
      const filename = "agencia-brasil-" + date.file + "-" + slugify(item.title) + ".md";
      const filepath = path.join(NEWS_DIR, filename);
      if (fs.existsSync(filepath)) continue;

      const content = [
        "---",
        "title: " + JSON.stringify(item.title),
        "date: " + date.display,
        "category: " + JSON.stringify(category),
        "thumbnail: " + image,
        "---",
        "",
        body,
        "",
        "Fonte: [Agência Brasil](" + item.link + ").",
        ""
      ].join("\n");

      fs.writeFileSync(filepath, content, "utf8");
      console.log("Notícia adicionada ao repositório: " + filename);
      publicadas++;
      arquivosCriados.push(filename);
    } catch (error) {
      console.log("Falha ao processar \"" + item.title + "\": " + error.message);
    }
  }

  if (publicadas === 0) {
    console.log("Nenhuma notícia nova, recente e elegível foi encontrada. A execução será encerrada sem alterações.");
    return;
  }

  console.log("Total de notícias publicadas nesta execução: " + publicadas + " de " + limitePorExecucao);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
