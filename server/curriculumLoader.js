// curriculumLoader.js
// Reads the `curriculum/` tree and turns it into a list of sections, each with
// an ordered list of "prompt -> target" drills (self-contained, drop-in folders).
//
// Expected layout:
//   curriculum/
//     03-01-declaring-variables/
//       section.json   -> { name, group, groupTitle, order,
//                           snippets: [ { instruction, targets: [...] }, ... ] }
//
// Two entry points:
//   loadCurriculum(root)         — walks the directory (dev / hot-reload mode)
//   loadCurriculumFromMap(map)   — parses { id -> section.json text } (packaged)
//
// Tabs in targets are expanded to 4 spaces for display (the frontend maps the
// Tab key to "advance through indentation", so the target never holds a tab).

import fs from 'node:fs';
import path from 'node:path';

function expandAndTrim(source) {
  return source
    .replace(/\t/g, '    ') // tabs -> 4 spaces
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function buildSection(id, meta, errors) {
  const rawSnippets = Array.isArray(meta.snippets) ? meta.snippets : [];
  const snippets = [];
  for (const raw of rawSnippets) {
    const instruction = String(raw.instruction || '').trim();
    const targets = Array.isArray(raw.targets)
      ? raw.targets.map((t) => expandAndTrim(String(t || ''))).filter(Boolean)
      : [];
    if (!instruction || !targets.length) {
      errors.push(`[${id}] skipped a snippet missing instruction or targets`);
      continue;
    }
    snippets.push({ instruction, targets });
  }

  if (!snippets.length) {
    errors.push(`[${id}] no usable snippets found`);
    return null;
  }

  return {
    id,
    name: meta.name || id,
    group: Number(meta.group) || 0,
    groupTitle: meta.groupTitle || '',
    order: String(meta.order || id),
    snippetCount: snippets.length,
    snippets,
  };
}

function sortSections(sections) {
  sections.sort((a, b) => a.order.localeCompare(b.order, undefined, { numeric: true }));
  return sections;
}

export function loadCurriculum(root) {
  const sections = [];
  const errors = [];

  if (!fs.existsSync(root)) {
    return { sections, errors: [`curriculum root not found: ${root}`] };
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    if (!entry.isDirectory()) continue;

    const id = entry.name;
    const manifestPath = path.join(root, entry.name, 'section.json');

    let meta = {};
    if (fs.existsSync(manifestPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        errors.push(`[${id}] invalid section.json: ${e.message}`);
        continue;
      }
    } else {
      errors.push(`[${id}] missing section.json — skipped`);
      continue;
    }

    const section = buildSection(id, meta, errors);
    if (section) sections.push(section);
  }

  return { sections: sortSections(sections), errors };
}

export function loadCurriculumFromMap(sectionJsons) {
  const sections = [];
  const errors = [];

  for (const [id, json] of Object.entries(sectionJsons)) {
    let meta;
    try {
      meta = JSON.parse(json);
    } catch (e) {
      errors.push(`[${id}] invalid section.json: ${e.message}`);
      continue;
    }
    const section = buildSection(id, meta, errors);
    if (section) sections.push(section);
  }

  return { sections: sortSections(sections), errors };
}
