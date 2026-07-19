// Sidecar Vending Services — static site build script
//
// What this does: takes the shared partials/header.html, partials/footer.html,
// and partials/shell.html, combines them with each page's unique content in
// src/*.html, and writes the finished, plain static HTML pages into dist/.
// It also copies styles.css and the images/ folder into dist/ untouched.
//
// You should never need to edit this file to add a new page or change the
// logo/footer/styling — just edit partials/header.html, partials/footer.html,
// styles.css, or add a new file under src/. This script just does the
// mechanical stitching, every time Cloudflare Pages builds the site.
//
// No npm packages required — only Node's built-in fs/path modules.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, 'src');
const PARTIALS_DIR = path.join(ROOT, 'partials');
const OUT_DIR = path.join(ROOT, 'dist');

// Any top-level files/folders here get copied into dist/ as-is.
const STATIC_COPY = ['styles.css', 'images'];

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

function build() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const shell = readPartial('shell.html');
  const header = readPartial('header.html');
  const footer = readPartial('footer.html');

  const pages = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.html'));

  for (const file of pages) {
    const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    const { title, description, content } = extractMeta(raw);

    const page = shell
      .replace('{{TITLE}}', title)
      .replace('{{DESCRIPTION}}', description)
      .replace('{{HEADER}}', header)
      .replace('{{CONTENT}}', content)
      .replace('{{FOOTER}}', footer);

    // src/home.html always becomes the site's real homepage: index.html
    const outName = file === 'home.html' ? 'index.html' : file;
    fs.writeFileSync(path.join(OUT_DIR, outName), page, 'utf8');
    console.log(`Built ${outName} from src/${file}`);
  }

  for (const item of STATIC_COPY) {
    copyRecursive(path.join(ROOT, item), path.join(OUT_DIR, item));
    console.log(`Copied ${item}`);
  }

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
