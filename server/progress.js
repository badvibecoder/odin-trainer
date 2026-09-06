// progress.js
// Persistent per-profile training progress. A "rep" is one clean completion of
// a snippet; a section is "trained" once its rep count reaches TRAINED_AT.
// Stored in data/progress.json and survives restarts. No authentication — the
// profile is a self-reported name, normalized case-insensitively.

import fs from 'node:fs';
import path from 'node:path';

export const TRAINED_AT = 100;

function keyOf(name) {
  const s = String(name || '').trim();
  return (s || 'me').toLowerCase();
}

export function createProgress(filePath) {
  let data = { profiles: {} };

  function load() {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && typeof parsed === 'object') data = parsed;
      }
    } catch {
      data = { profiles: {} };
    }
    if (!data.profiles || typeof data.profiles !== 'object') data.profiles = {};
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function ensure(profile) {
    const k = keyOf(profile);
    if (!data.profiles[k] || typeof data.profiles[k] !== 'object') {
      data.profiles[k] = { name: String(profile || '').trim() || 'me', sections: {} };
    }
    if (!data.profiles[k].sections || typeof data.profiles[k].sections !== 'object') {
      data.profiles[k].sections = {};
    }
    return data.profiles[k];
  }

  load();

  return {
    get(profile) {
      const k = keyOf(profile);
      const p = data.profiles[k];
      return {
        profile: k,
        name: p && p.name ? p.name : String(profile || '').trim() || 'me',
        sections: (p && p.sections) || {},
      };
    },

    addRep(profile, section) {
      const p = ensure(profile);
      const reps = Math.min((Number(p.sections[section]) || 0) + 1, 1000000);
      p.sections[section] = reps;
      p.updatedAt = new Date().toISOString();
      persist();
      return { section, reps, trained: reps >= TRAINED_AT };
    },

    reset(profile, section) {
      const p = ensure(profile);
      p.sections[section] = 0;
      p.updatedAt = new Date().toISOString();
      persist();
      return { section, reps: 0, trained: false };
    },

    wipe() {
      data = { profiles: {} };
      persist();
      return { ok: true };
    },
  };
}
