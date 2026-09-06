// extract-book.mjs
// Parses the single-file Odin book (odinbook/odin_book_1_10.html) and pulls out
// every code <pre> block, tagged with its chapter + section, so we can curate
// the training curriculum from the book's real code examples (1:1 scale).
//
// Usage: node scripts/extract-book.mjs [out.json]
// Output: JSON array of { chapter, chapterTitle, section, sectionTitle, code }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOK = path.join(ROOT, 'odinbook', 'odin_book_1_10.html');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'book-extract.json');

const html = fs.readFileSync(BOOK, 'utf8');

// --- entity decoding -----------------------------------------------------
const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in NAMED ? NAMED[name] : m));
}

// Strip syntax-highlight spans and any other inline markup inside a <pre>.
// IMPORTANT: this runs on the RAW (still-escaped) text, BEFORE entity decoding,
// so Odin's escaped comparison operators (&lt; &gt;) are never mistaken for tags.
function cleanCode(inner) {
  return inner
    .replace(/<span\b[^>]*>/g, '')
    .replace(/<\/span>/g, '')
    .replace(/<[^>]+>/g, ''); // belt-and-suspenders: drop any residual tags
}

function stripTagsPreserve(inner) {
  // For heading titles: keep text inside <code> but drop the tags.
  return inner.replace(/<[^>]+>/g, '');
}

// --- combined linear scan ------------------------------------------------
// Matches, in document order:
//   1. chapter heading  ->  Chapter N, <h1>Title</h1>
//   2. section heading  ->  <h2|h3>Title<span class='chapter-number'>X.Y</span>
//   3. code block       ->  <pre [attrs]>…</pre>
const RE = new RegExp(
  "<div class='chapter-heading[^']*'>[\\s\\S]*?Chapter\\s+(\\d+)<\\/span>[\\s\\S]*?<h1>(.*?)<\\/h1>" +
  '|<h([234])\\b[^>]*>([\\s\\S]*?)<span class=\'chapter-number\'>([^<]*)<\\/span>' +
  '|<pre([^>]*)>([\\s\\S]*?)<\\/pre>',
  'g',
);

const entries = [];
let chapter = null;
let chapterTitle = '';
let section = '';
let sectionTitle = '';

for (const m of html.matchAll(RE)) {
  if (m[1] != null) {
    // chapter heading
    chapter = Number(m[1]);
    chapterTitle = decodeEntities(stripTagsPreserve(m[2])).trim();
  } else if (m[3] != null) {
    // section heading (h2/h3)
    const num = m[5].trim();
    section = num || '';
    sectionTitle = decodeEntities(stripTagsPreserve(m[4])).trim();
  } else {
    // code block
    const attrs = m[6] || '';
    if (attrs.includes("class='error'") || attrs.includes("class='warning'")) continue;
    const raw = m[7];
    const code = decodeEntities(cleanCode(raw))
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
    if (!code.trim()) continue;
    entries.push({
      chapter,
      chapterTitle,
      section,
      sectionTitle,
      code,
    });
  }
}

fs.writeFileSync(OUT, JSON.stringify(entries, null, 2));
const byChapter = {};
for (const e of entries) byChapter[e.chapter] = (byChapter[e.chapter] || 0) + 1;
console.log(`extracted ${entries.length} code blocks -> ${OUT}`);
console.log('blocks per chapter:', byChapter);
