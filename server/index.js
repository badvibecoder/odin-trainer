// odin-trainer — server entrypoint
// Dependency-free (Node built-ins only): serves the static frontend plus a
// small JSON API for the muscle-memory drill curriculum and progress:
//
//   GET  /api/health
//   GET  /api/curriculum        -> section metadata (no snippet bodies)
//   GET  /api/section/:id       -> one section incl. ordered snippet bodies
//   GET  /api/progress?profile= -> rep counts per section for a profile
//   POST /api/reps              -> { profile, section }  +1 clean rep
//   POST /api/reset             -> { profile, section }  zero a section
//   GET  /api/reload            -> re-read the curriculum tree
//   GET  /api/music             -> list drop-in music tracks
//   GET  /api/profile           -> the active username ("" if unset)
//   POST /api/profile           -> { name }  set the active username
//   POST /api/wipe              -> clear profile + progress (start over)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadCurriculum, loadCurriculumFromMap } from './curriculumLoader.js';
import { createProgress, TRAINED_AT } from './progress.js';
import { EMBEDDED } from './embedded.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CURRICULUM_DIR = path.join(ROOT, 'curriculum');
const DATA_DIR = process.env.ODIN_DATA_DIR || path.join(os.homedir(), '.odin-trainer');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MUSIC_DIR = path.join(ROOT, 'music');
const THOCK_DIR = path.join(ROOT, 'thock');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');

// Self-provision the user data folder on first run (no installer / manual step).
fs.mkdirSync(DATA_DIR, { recursive: true });

const PACKAGED = process.env.ODIN_PACKAGED === '1' || !fs.existsSync(PUBLIC_DIR);
const PORT = Number(process.env.PORT) || 8080;

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// --- curriculum state (reloadable) --------------------------------------
let curriculum = { sections: [], errors: [] };
function reload() {
  const loaded = PACKAGED ? loadCurriculumEmbedded() : loadCurriculum(CURRICULUM_DIR);
  curriculum = loaded;
  console.log(
    `[curriculum] loaded ${loaded.sections.length} section(s): ` +
      loaded.sections.map((s) => `${s.id}(${s.snippetCount})`).join(', '),
  );
  for (const err of loaded.errors) console.warn(`[curriculum] ${err}`);
  return loaded;
}
reload();

try {
  if (!PACKAGED) {
    const watcher = fs.watch(CURRICULUM_DIR, { recursive: true }, debounce(reload, 600));
    watcher.on('error', () => {});
  }
} catch {
  // recursive watch unsupported on some platforms — /api/reload still works.
}

const progress = createProgress(PROGRESS_FILE);

// --- profile (active username) ------------------------------------------
function readProfileName() {
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      const p = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
      return typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '';
    }
  } catch {}
  return '';
}
function writeProfileName(name) {
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ name }));
}
function wipeUserData() {
  progress.wipe();
  for (const f of [PROFILE_FILE, PROGRESS_FILE]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}
function cleanName(name) {
  return String(name || '').trim().slice(0, 24);
}

// --- embedded assets (packaged single-file mode) ------------------------
function embeddedBuffer(rel) {
  const data = EMBEDDED.files[rel];
  if (data === undefined) return null;
  return EMBEDDED.binary.includes(rel) ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
}

function serveBuffer(res, buf, type, range) {
  const total = buf.length;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
    let end = m && m[2] !== '' ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  });
  res.end(buf);
}

function loadCurriculumEmbedded() {
  const map = {};
  for (const [rel, data] of Object.entries(EMBEDDED.files)) {
    if (rel.startsWith('curriculum/') && rel.endsWith('/section.json')) {
      const id = rel.slice('curriculum/'.length, -'/section.json'.length);
      if (!id.includes('/')) map[id] = data;
    }
  }
  return loadCurriculumFromMap(map);
}

function listMusicEmbedded() {
  const tracks = [];
  for (const rel of Object.keys(EMBEDDED.files)) {
    if (!rel.startsWith('music/')) continue;
    if (!EMBEDDED.binary.includes(rel)) continue;
    const file = path.basename(rel);
    if (!AUDIO_EXT.has(path.extname(file).toLowerCase())) continue;
    tracks.push({ file, name: prettifyTrackName(file), url: '/music/' + encodeURIComponent(file) });
  }
  return tracks.sort((a, b) => a.name.localeCompare(b.name));
}

function serveStaticEmbedded(res, pathname) {
  const rel = pathname === '/' ? 'public/index.html' : 'public' + decodeURIComponent(pathname);
  const buf = embeddedBuffer(rel);
  if (!buf) return sendJson(res, 404, { error: 'not found' });
  const ext = path.extname(rel).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(buf);
}

function serveThockEmbedded(res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/thock\//, 'thock/');
  const buf = embeddedBuffer(rel);
  if (!buf) return sendJson(res, 404, { error: 'not found' });
  const ext = path.extname(rel).toLowerCase();
  const type = ext === '.ogg' ? 'audio/ogg'
    : ext === '.json' ? 'application/json; charset=utf-8'
    : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(buf);
}

function serveMusicEmbedded(req, res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/music\//, 'music/');
  const buf = embeddedBuffer(rel);
  if (!buf) return sendJson(res, 404, { error: 'not found' });
  const ext = path.extname(rel).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return sendJson(res, 403, { error: 'forbidden' });
  serveBuffer(res, buf, AUDIO_MIME[ext] || 'application/octet-stream', req.headers.range);
}

const sectionById = new Map(curriculum.sections.map((s) => [s.id, s]));

// --- server -------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  const method = req.method || 'GET';

  try {
    if (route.startsWith('/api/')) return handleApi(req, res, url, method, route);
    if (route.startsWith('/music/')) return serveMusic(req, res, url.pathname);
    if (route.startsWith('/thock/')) return serveThock(res, url.pathname);
    return serveStatic(res, url.pathname);
  } catch (err) {
    sendJson(res, 500, { error: 'internal error', detail: String(err && err.message) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && actualPort < PORT + 50) {
    actualPort += 1;
    setTimeout(() => server.listen(actualPort), 100);
  } else {
    console.error('[server] failed to listen:', err && err.message);
    process.exit(1);
  }
});
let actualPort = PORT;
server.listen(actualPort, () => {
  const url = `http://localhost:${actualPort}`;
  console.log(`\n  ⚰️  odin-trainer running at ${url}\n`);
  openBrowser(url);
});

function openBrowser(url) {
  if (process.env.ODIN_NO_OPEN === '1') return;
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

// --- API routing --------------------------------------------------------
function handleApi(req, res, url, method, route) {
  if (method === 'GET' && route === '/api/health') return sendJson(res, 200, { ok: true });

  if (method === 'GET' && route === '/api/music') {
    return sendJson(res, 200, { tracks: listMusic() });
  }

  if (method === 'GET' && route === '/api/curriculum') {
    return sendJson(res, 200, {
      sections: curriculum.sections.map((s) => ({
        id: s.id,
        name: s.name,
        group: s.group,
        groupTitle: s.groupTitle,
        order: s.order,
        snippetCount: s.snippetCount,
      })),
    });
  }

  if (method === 'GET' && route.startsWith('/api/section/')) {
    const id = decodeURIComponent(route.slice('/api/section/'.length));
    const section = sectionById.get(id);
    if (!section) return sendJson(res, 404, { error: `unknown section: ${id}` });
    return sendJson(res, 200, {
      section: {
        id: section.id,
        name: section.name,
        group: section.group,
        groupTitle: section.groupTitle,
        order: section.order,
        snippetCount: section.snippetCount,
      },
      snippets: section.snippets,
    });
  }

  if (method === 'GET' && route === '/api/profile') {
    return sendJson(res, 200, { name: readProfileName() });
  }

  if (method === 'POST' && route === '/api/profile') {
    return readJsonBody(req).then((body) => {
      try {
        const name = cleanName(body && body.name);
        if (!name) throw new ApiError('name is required');
        writeProfileName(name);
        sendJson(res, 200, { name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, err instanceof ApiError ? err.status : 400, { error: msg });
      }
    });
  }

  if (method === 'POST' && route === '/api/wipe') {
    wipeUserData();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && route === '/api/progress') {
    const profile = url.searchParams.get('profile') || 'me';
    const p = progress.get(profile);
    return sendJson(res, 200, { ...p, trainedAt: TRAINED_AT });
  }

  if (method === 'POST' && route === '/api/reps') {
    return readJsonBody(req).then((body) => {
      try {
        const section = String((body && body.section) || '');
        if (!sectionById.has(section)) throw new ApiError(`unknown section: ${section || '(none)'}`);
        const result = progress.addRep(body.profile, section);
        sendJson(res, 200, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, err instanceof ApiError ? err.status : 400, { error: msg });
      }
    });
  }

  if (method === 'POST' && route === '/api/reset') {
    return readJsonBody(req).then((body) => {
      try {
        const section = String((body && body.section) || '');
        if (!sectionById.has(section)) throw new ApiError(`unknown section: ${section || '(none)'}`);
        const result = progress.reset(body.profile, section);
        sendJson(res, 200, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, err instanceof ApiError ? err.status : 400, { error: msg });
      }
    });
  }

  if (method === 'GET' && route === '/api/reload') {
    const loaded = reload();
    sectionById.clear();
    for (const s of loaded.sections) sectionById.set(s.id, s);
    return sendJson(res, 200, { ok: true, sections: loaded.sections.length });
  }

  sendJson(res, 404, { error: 'not found' });
}

// --- music --------------------------------------------------------------
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.aac', '.opus', '.webm', '.mid']);
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.mid': 'audio/midi',
};

function listMusic() {
  if (PACKAGED) return listMusicEmbedded();
  if (!fs.existsSync(MUSIC_DIR)) return [];
  return fs.readdirSync(MUSIC_DIR)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((file) => ({
      file,
      name: prettifyTrackName(file),
      url: '/music/' + encodeURIComponent(file),
    }));
}

function prettifyTrackName(file) {
  let base = path.basename(file, path.extname(file));
  base = base.replace(/^\d+[-_.]+/, '');
  base = base.replace(/[-_]+/g, ' ');
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

function serveMusic(req, res, pathname) {
  if (PACKAGED) return serveMusicEmbedded(req, res, pathname);
  const rel = decodeURIComponent(pathname).replace(/^\/music\//, '');
  if (!rel || rel.includes('..') || rel.includes('/')) return sendJson(res, 403, { error: 'forbidden' });
  const filePath = path.join(MUSIC_DIR, rel);
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXT.has(ext)) return sendJson(res, 403, { error: 'forbidden' });

  fs.stat(filePath, (err, stat) => {
    if (err) {
      if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 500, { error: 'read error' });
    }
    const total = stat.size;
    const type = AUDIO_MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
      let end = m && m[2] !== '' ? parseInt(m[2], 10) : total - 1;
      if (Number.isNaN(start) || start < 0) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      stream.on('error', () => res.end());
      return;
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Serve the "thock" sound-pack directory (config.json + audio files).
function serveThock(res, pathname) {
  if (PACKAGED) return serveThockEmbedded(res, pathname);
  const rel = decodeURIComponent(pathname).replace(/^\/thock\//, '');
  if (!rel || rel.includes('/') || rel.includes('..')) return sendJson(res, 403, { error: 'forbidden' });
  const filePath = path.join(THOCK_DIR, rel);
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === '.ogg' ? 'audio/ogg'
    : ext === '.json' ? 'application/json; charset=utf-8'
    : ext === '.wav' ? 'audio/wav'
    : ext === '.mp3' ? 'audio/mpeg'
    : ext === '.flac' ? 'audio/flac'
    : ext === '.m4a' ? 'audio/mp4'
    : 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 500, { error: 'read error' });
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// --- static serving -----------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(res, pathname) {
  if (PACKAGED) return serveStaticEmbedded(res, pathname);
  let rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 500, { error: 'read error' });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// --- helpers ------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 256 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export default server;
