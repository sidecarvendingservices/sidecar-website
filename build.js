// Sidecar Vending Services — static site build script
//
// What this does: takes the shared partials/header.html, partials/footer.html,
// and partials/shell.html, combines them with each page's unique content in
// src/*.html, and writes the finished, plain static HTML pages into dist/.
// It also copies styles.css and the images/ folder into dist/ untouched.
//
// It also auto-generates two kinds of SEO/AEO structured data (JSON-LD) from
// content that's already on the page, so there's nothing extra to maintain:
//   - FAQPage schema, built from any ".faq-item" blocks on the page
//   - BreadcrumbList schema, built from the ".breadcrumb" trail on the page
// If you edit the visible FAQ questions/answers or breadcrumb links in a
// src/*.html file, the structured data updates automatically on next build —
// you never need to hand-edit JSON-LD separately.
//
// You should never need to edit this file to add a new page or change the
// logo/footer/styling — just edit partials/header.html, partials/footer.html,
// styles.css, or add a new file under src/. This script just does the
// mechanical stitching, every time Cloudflare Pages builds the site.
//
// No npm packages required — only Node's built-in fs/path modules.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, 'src');
const PARTIALS_DIR = path.join(ROOT, 'partials');
const OUT_DIR = path.join(ROOT, 'dist');
const BASE_URL = 'https://sidecarservices.com';

// Any top-level files/folders here get copied into dist/ as-is.
const STATIC_COPY = ['styles.css', 'images', 'robots.txt'];

// Priority hints for sitemap.xml, keyed by the OUTPUT filename. Anything not
// listed here defaults to 0.6. Pages in PASSTHROUGH_PAGES are never included
// in the sitemap (e.g. thank-you.html is marked noindex and shouldn't be).
const SITEMAP_PRIORITY = {
  'index.html': '1.0',
  'how-it-works.html': '0.8',
  'industries.html': '0.8',
  'faq.html': '0.8',
  'service-area.html': '0.8',
  'about.html': '0.6',
};

// Any top-level HTML files here are copied straight into dist/ without
// going through the header/footer template (useful for one-off pages like
// a HubSpot/ad "thank you" page that shouldn't have the normal nav).
const PASSTHROUGH_PAGES = ['thank-you.html'];

function readPartial(name) {
  return fs.readFileSync(path.join(PARTIALS_DIR, name), 'utf8');
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// Pulls "<!-- TITLE: ... -->" and "<!-- DESCRIPTION: ... -->" comments off
// the top of a src page and returns the rest as the page's body content.
function extractMeta(raw) {
  const titleMatch = raw.match(/<!--\s*TITLE:\s*([\s\S]*?)\s*-->/);
  const descMatch = raw.match(/<!--\s*DESCRIPTION:\s*([\s\S]*?)\s*-->/);
  const title = titleMatch ? titleMatch[1] : 'Sidecar Vending Services';
  const description = descMatch ? descMatch[1] : '';
  const content = raw
    .replace(/<!--\s*TITLE:[\s\S]*?-->/, '')
    .replace(/<!--\s*DESCRIPTION:[\s\S]*?-->/, '')
    .trim();
  return { title, description, content };
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(str) {
  return decodeEntities(str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

// Builds FAQPage JSON-LD from every ".faq-item" block (h3 question + p
// answer) found in the page's rendered content. Returns '' if none found.
function buildFaqSchema(content) {
  const items = [];
  const itemRegex = /<div class="faq-item">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g;
  let m;
  while ((m = itemRegex.exec(content))) {
    items.push({
      '@type': 'Question',
      name: stripTags(m[1]),
      acceptedAnswer: { '@type': 'Answer', text: stripTags(m[2]) },
    });
  }
  if (!items.length) return '';
  const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items };
  return `\n<script type="application/ld+json">${JSON.stringify(schema)}</script>\n`;
}

// Builds BreadcrumbList JSON-LD from the ".breadcrumb" trail found in the
// page's rendered content (e.g. "Home / Industries / Gym Vending"). Returns
// '' if the page has no breadcrumb (i.e. the homepage).
function buildBreadcrumbSchema(content) {
  const bcMatch = content.match(/<div class="breadcrumb">([\s\S]*?)<\/div>/);
  if (!bcMatch) return '';
  const inner = bcMatch[1];
  const parts = [];
  const linkRegex = /<a href="([^"]+)">([\s\S]*?)<\/a>/g;
  let lastIndex = 0;
  let m;
  while ((m = linkRegex.exec(inner))) {
    parts.push({ url: m[1], name: stripTags(m[2]) });
    lastIndex = linkRegex.lastIndex;
  }
  const trailing = stripTags(inner.slice(lastIndex).replace(/^\s*\/\s*/, ''));
  if (trailing) parts.push({ url: null, name: trailing });
  if (!parts.length) return '';
  const itemListElement = parts.map((p, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: p.name,
    ...(p.url ? { item: p.url === '/' ? `${BASE_URL}/` : `${BASE_URL}${p.url}` } : {}),
  }));
  const schema = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement };
  return `\n<script type="application/ld+json">${JSON.stringify(schema)}</script>\n`;
}

function build() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const shell = readPartial('shell.html');
  const header = readPartial('header.html');
  const footer = readPartial('footer.html');

  // Cache-busting version for styles.css, derived from the file's own
  // content. This changes automatically whenever styles.css changes, and
  // ONLY when it changes — so browsers (and any CDN edge cache) that
  // already have an old copy are forced to fetch the new one instead of
  // silently reusing a stale cached stylesheet against new page markup.
  const stylesPath = path.join(ROOT, 'styles.css');
  const stylesVersion = fs.existsSync(stylesPath)
    ? crypto.createHash('md5').update(fs.readFileSync(stylesPath)).digest('hex').slice(0, 8)
    : 'dev';

  const pages = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.html'));
  const sitemapUrls = [];

  for (const file of pages) {
    const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    const { title, description, content } = extractMeta(raw);

    // src/home.html always becomes the site's real homepage: index.html
    const outName = file === 'home.html' ? 'index.html' : file;
    const canonicalPath = outName === 'index.html' ? '' : `/${outName.replace(/\.html$/, '')}`;
    const canonicalUrl = `${BASE_URL}${canonicalPath || '/'}`;

    const breadcrumbSchema = buildBreadcrumbSchema(content);
    const faqSchema = buildFaqSchema(content);

    const page = shell
      .replace(/{{TITLE}}/g, title)
      .replace(/{{DESCRIPTION}}/g, description)
      .replace(/{{CANONICAL}}/g, canonicalUrl)
      .replace(/{{STYLES_VERSION}}/g, stylesVersion)
      .replace('{{HEADER}}', header)
      .replace('{{CONTENT}}', content + breadcrumbSchema + faqSchema)
      .replace('{{FOOTER}}', footer);

    fs.writeFileSync(path.join(OUT_DIR, outName), page, 'utf8');
    console.log(`Built ${outName} from src/${file}`);

    sitemapUrls.push({ loc: canonicalUrl, priority: SITEMAP_PRIORITY[outName] || '0.6' });
  }

  for (const item of STATIC_COPY) {
    copyRecursive(path.join(ROOT, item), path.join(OUT_DIR, item));
    console.log(`Copied ${item}`);
  }

  // sitemap.xml — auto-generated from whatever pages exist in src/ at build
  // time, so a new page under src/ is included automatically with no extra
  // step. thank-you.html is deliberately excluded (it's a noindex page).
  const today = new Date().toISOString().slice(0, 10);
  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapUrls.map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${u.priority}</priority>\n  </url>`
    ),
    '</urlset>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), sitemapXml, 'utf8');
  console.log(`Generated sitemap.xml (${sitemapUrls.length} URLs)`);

  for (const file of PASSTHROUGH_PAGES) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(OUT_DIR, file));
      console.log(`Copied passthrough page ${file}`);
    }
  }

  console.log('Build complete.');
}

build();
