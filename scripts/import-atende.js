const BASE = "https://canoinhas.atende.net";
const RSS_CANDIDATES = [
  `${BASE}/cidadao/noticia/rss?output=1`,
  `${BASE}/cidadao/noticia/rss`,
  `${BASE}/cidadao/noticia?output=1`,
];

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

async function getLinksFromRss() {
  const { xml, url } = await fetchRssXml();
  if (!xml) return [];

  console.log("RSS usado:", url);
  console.log("RSS (inicio):", xml.slice(0, 300));

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    cdataPropName: "__cdata",
  });

  const obj = parser.parse(xml);

  const items = obj?.rss?.channel?.item || obj?.feed?.entry || [];
  const arr = Array.isArray(items) ? items : [items];

  const links = arr
    .map((it) => {
      if (typeof it?.link === "string") return it.link.trim();
      if (it?.link?.__cdata) return String(it.link.__cdata).trim();

      if (typeof it?.guid === "string") return it.guid.trim();
      if (it?.guid?.__cdata) return String(it.guid.__cdata).trim();

      if (it?.link?.["@_href"]) return String(it.link["@_href"]).trim();
      if (Array.isArray(it?.link)) {
        const first = it.link.find((x) => x?.["@_href"])?.["@_href"];
        if (first) return String(first).trim();
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
