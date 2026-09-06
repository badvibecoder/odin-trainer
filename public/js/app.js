// odin-trainer — frontend: drill engine, recall/train modes, completion, progress, scorecard.

(function () {
  'use strict';

  // ---- DOM -------------------------------------------------------------
  const els = {
    sectionSelect: document.getElementById('section-select'),
    sectionTag: document.getElementById('section-tag'),
    drillTitle: document.getElementById('drill-title'),
    snippetStatus: document.getElementById('snippet-status'),
    repCount: document.getElementById('rep-count'),
    trainedBadge: document.getElementById('trained-badge'),
    codeTitle: document.getElementById('code-title'),
    codeArea: document.getElementById('code-area'),
    codeFrame: document.querySelector('.code-frame'),
    promptInstruction: document.getElementById('prompt-instruction'),
    promptDescriptor: document.getElementById('prompt-descriptor'),
    hint: document.getElementById('hint'),
    restartBtn: document.getElementById('restart-btn'),
    skipBtn: document.getElementById('skip-btn'),
    prevBtn: document.getElementById('prev-btn'),
    peekBtn: document.getElementById('peek-btn'),
    modeToggle: document.getElementById('mode-toggle'),
    themeSelect: document.getElementById('theme-select'),
    profileInput: document.getElementById('profile-input'),
    profileNameInput: document.getElementById('profile-name-input'),
    profileSaveBtn: document.getElementById('profile-save-btn'),
    profileModal: document.getElementById('profile-modal'),
    resetBtn: document.getElementById('reset-btn'),
    scBody: document.getElementById('sc-body'),
    scSummary: document.getElementById('sc-summary'),
    navBtns: Array.from(document.querySelectorAll('.nav__btn')),
    views: Array.from(document.querySelectorAll('.view')),
    musicField: document.getElementById('music-field'),
    musicPlayer: document.getElementById('music-player'),
    musicTitle: document.getElementById('music-title'),
    musicToggle: document.getElementById('music-toggle'),
    musicPrev: document.getElementById('music-prev'),
    musicNext: document.getElementById('music-next'),
    musicVolume: document.getElementById('music-volume'),
    soundToggle: document.getElementById('sound-toggle'),
    soundIcon: document.getElementById('sound-icon'),
    fontSizeBtn: document.getElementById('font-size-btn'),
    toast: document.getElementById('toast'),
    toastGlyph: document.getElementById('toast-glyph'),
    toastText: document.getElementById('toast-text'),
  };

  // ---- state -----------------------------------------------------------
  const state = {
    profile: '',
    trainedAt: 100,
    mode: 'recall',     // 'recall' (target hidden) | 'train' (target shown)
    peeked: false,      // recall-mode one-shot reveal of the current target
    sections: [],
    currentSectionId: null,
    section: null,
    snippets: [],
    current: null,      // { instruction, targets }
    lastPicks: {},      // drill index -> last-shown variation index
    index: 0,
    reps: 0,
    pos: 0,
    text: '',
    completing: false,
    fontSize: 20.5,
  };

  const FONT_SIZES = [16.5, 20.5, 24.5];
  const DEFAULT_FONT_SIZE = 20.5;
  const TAB_WIDTH = 4; // matches the server's tab -> 4-space expansion

  // Recall mode ("type from memory") is DISABLED for now. Recall-from-instruction
  // is only fair when the prompt fully determines the answer, but real Odin has
  // arbitrary identifiers/literals (package names, string contents, magic
  // numbers) that a natural-language prompt cannot specify. Straight copy is the
  // simplest muscle-memory loop. Revisit recall once we build a per-declaration-
  // type rule engine; the setMode()/peek()/placeholder code below stays intact.
  const RECALL_ENABLED = false;

  let currentView = 'drill';
  let flat = [];
  let lines = [];
  let lineStart = [];
  let charState = [];
  let cells = [];
  let cursorIdx = null;
  let shiftedRow = null;
  let toastTimer = null;

  // ---- helpers ---------------------------------------------------------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let msg = res.statusText || 'request failed';
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (_) {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- snippet rendering ------------------------------------------------
  // What a cell shows depends on its typed state AND the mode:
  //   newline        -> '⏎' always
  //   typed (ok/bad) -> the target char (green/red)
  //   untyped        -> target char in train/peek, else a '·' placeholder
  function displayText(idx) {
    if (flat[idx] === '\n') return '⏎';
    if (charState[idx] !== 'pending') return flat[idx];
    if (state.mode === 'train' || state.peeked) return flat[idx];
    return '·';
  }

  function setSnippet(text) {
    state.text = text;
    flat = text.split('');
    lines = text.split('\n');
    lineStart = [];
    let idx = 0;
    for (const ln of lines) {
      lineStart.push(idx);
      idx += ln.length + 1;
    }
    charState = new Array(flat.length).fill('pending');
    cells = new Array(flat.length).fill(null);
    cursorIdx = null;
    shiftedRow = null;
    state.pos = 0;
    els.codeArea.innerHTML = '';
    els.codeFrame.classList.remove('is-complete');
    for (let i = 0; i < lines.length; i++) renderLine(i);
    els.codeArea.scrollTop = 0;
    els.codeArea.scrollLeft = 0;
    updateCaret();
  }

  function renderLine(i) {
    const line = lines[i];
    const start = lineStart[i];
    const row = document.createElement('div');
    row.className = 'code-line';

    const num = document.createElement('span');
    num.className = 'lineno';
    num.textContent = String(i + 1);
    row.appendChild(num);

    for (let k = 0; k < line.length; k++) {
      const cell = makeCell(displayText(start + k), 'cell');
      row.appendChild(cell);
      cells[start + k] = cell;
    }

    if (i < lines.length - 1) {
      const newlineIdx = start + line.length;
      const cell = makeCell('⏎', 'cell newline');
      row.appendChild(cell);
      cells[newlineIdx] = cell;
    }

    els.codeArea.appendChild(row);
  }

  function makeCell(text, className) {
    const cell = document.createElement('span');
    cell.className = className;
    cell.textContent = text;
    return cell;
  }

  function baseClasses(idx) {
    let c = 'cell';
    if (flat[idx] === '\n') c += ' newline';
    c += ' ' + charState[idx];
    return c;
  }

  function refreshCell(idx) {
    const cell = cells[idx];
    if (!cell) return;
    cell.className = baseClasses(idx) + (idx === cursorIdx ? ' cursor' : '');
    cell.textContent = displayText(idx);
  }

  function refreshAllCells() {
    for (let i = 0; i < cells.length; i++) refreshCell(i);
    updateCaret();
  }

  function updateCaret() {
    const prev = cursorIdx;
    cursorIdx = state.pos;
    if (prev !== null && prev < cells.length && cells[prev]) refreshCell(prev);
    if (cursorIdx < cells.length && cells[cursorIdx]) {
      refreshCell(cursorIdx);
      scrollToCell(cells[cursorIdx]);
    }
  }

  function scrollToCell(cell) {
    const area = els.codeArea;
    const areaRect = area.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    const relTop = cellRect.top - areaRect.top + area.scrollTop;
    const vMargin = 46;
    if (relTop < area.scrollTop + vMargin || relTop > area.scrollTop + area.clientHeight - vMargin) {
      area.scrollTop = relTop - area.clientHeight / 2;
    }

    const row = cell.parentElement;
    if (!row) return;
    if (shiftedRow && shiftedRow !== row) shiftedRow.style.transform = '';
    shiftedRow = row;

    const caretX = cellRect.left - row.getBoundingClientRect().left;
    const shift = Math.max(0, caretX - area.clientWidth * 0.5);
    row.style.transform = shift > 0 ? `translateX(${-shift}px)` : '';
  }

  function triggerShake(cell) {
    if (!cell) return;
    cell.classList.remove('shake');
    void cell.offsetWidth;
    cell.classList.add('shake');
  }

  // ---- prompt bar + mode ------------------------------------------------
  function renderPrompt(snip) {
    els.promptInstruction.textContent = snip.instruction || '';
    els.promptDescriptor.textContent = '';
    els.promptDescriptor.classList.add('is-hidden');
  }

  function updatePeekBtn() {
    els.peekBtn.classList.toggle('is-hidden', !(state.mode === 'recall' && !state.peeked));
  }

  function setMode(mode) {
    if (!RECALL_ENABLED) mode = 'train';
    state.mode = mode;
    state.peeked = false;
    localStorage.setItem('odin.mode', mode);
    els.modeToggle.textContent = mode;
    els.modeToggle.classList.toggle('is-recall', mode === 'recall');
    els.modeToggle.classList.toggle('is-train', mode === 'train');
    updatePeekBtn();
    refreshAllCells();
  }

  function peek() {
    if (!RECALL_ENABLED || state.mode !== 'recall') return;
    state.peeked = true;
    updatePeekBtn();
    refreshAllCells();
  }

  // ---- completion -------------------------------------------------------
  function isComplete() {
    return state.pos === flat.length && charState.every((s) => s === 'correct');
  }

  function checkComplete() {
    if (state.pos < flat.length) return;
    if (isComplete()) completeSnippet();
    else setHint('✗ fix the highlighted characters — reach the end clean to earn the rep', 'is-error');
  }

  function completeSnippet() {
    if (state.completing) return;
    state.completing = true;

    els.codeFrame.classList.add('is-complete');
    setHint('✓ clean — +1 rep', 'is-success');
    showToast('✓', '+1 rep');
    playThock();

    const prevReps = state.reps;
    state.reps = prevReps + 1;
    updateRepMeter();

    api('/api/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: state.profile, section: state.currentSectionId }),
    })
      .then((r) => {
        state.reps = r.reps;
        updateRepMeter();
      })
      .catch(() => {
        state.reps = prevReps;
        updateRepMeter();
      });

    setTimeout(() => {
      state.completing = false;
      advance(1);
    }, 460);
  }

  function advance(delta) {
    if (!state.snippets.length) return;
    const next = state.index + delta;
    if (next >= state.snippets.length) return gotoAdjacentSection(1);
    if (next < 0) return gotoAdjacentSection(-1);
    state.index = next;
    renderCurrentSnippet();
  }

  // Move to the next (direction +1) or previous (direction -1) section,
  // wrapping around the whole curriculum. Forward starts at the first snippet;
  // backward starts at the last snippet.
  function gotoAdjacentSection(direction) {
    const cur = state.sections.findIndex((s) => s.id === state.currentSectionId);
    if (cur === -1) return;
    const next = (cur + direction + state.sections.length) % state.sections.length;
    selectSection(state.sections[next].id, direction < 0 ? 'last' : 0);
  }

  function pickVariation(drillIndex, len) {
    if (len <= 1) return 0;
    const last = state.lastPicks[drillIndex];
    let pick;
    do { pick = Math.floor(Math.random() * len); } while (len > 1 && pick === last);
    state.lastPicks[drillIndex] = pick;
    return pick;
  }

  function renderCurrentSnippet() {
    if (!state.snippets.length) {
      setSnippet('');
      return;
    }
    const snip = state.snippets[state.index];
    state.current = snip;
    state.peeked = false;
    updatePeekBtn();
    renderPrompt(snip);
    const targets = snip.targets && snip.targets.length ? snip.targets : [snip.target];
    setSnippet(targets[pickVariation(state.index, targets.length)]);
    els.snippetStatus.textContent = `snippet ${state.index + 1} / ${state.snippets.length}`;
    setHint('start typing — <kbd>Tab</kbd> indents · <kbd>Backspace</kbd> fixes · <kbd>Esc</kbd> skip · <kbd>Ctrl</kbd>+<kbd>R</kbd> restart', '');
    els.codeArea.focus();
  }

  function restartSnippet() {
    if (state.completing) return;
    state.peeked = false;
    updatePeekBtn();
    setSnippet(state.text);
    setHint('start typing — <kbd>Tab</kbd> indents · <kbd>Backspace</kbd> fixes · <kbd>Esc</kbd> skip', '');
    els.codeArea.focus();
  }

  function skip() {
    if (state.completing) return;
    setHint('skipped — no rep earned', '');
    advance(1);
  }

  // ---- meter / header ---------------------------------------------------
  function updateRepMeter() {
    els.repCount.innerHTML = `${state.reps}<span class="meter-total">/${state.trainedAt}</span>`;
    els.trainedBadge.classList.toggle('is-hidden', state.reps < state.trainedAt);
  }

  function setHint(html, cls) {
    els.hint.innerHTML = html;
    els.hint.className = 'hint' + (cls ? ' ' + cls : '');
  }

  function showToast(glyph, text) {
    els.toastGlyph.textContent = glyph;
    els.toastText.textContent = text;
    els.toast.classList.remove('is-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('is-hidden'), 900);
  }

  // ---- curriculum + progress -------------------------------------------
  async function loadCurriculum() {
    try {
      const res = await api('/api/curriculum');
      state.sections = res.sections;
      renderSectionSelect();
      if (state.sections.length) {
        const first = state.sections[0].id;
        els.sectionSelect.value = first;
        await selectSection(first);
      }
    } catch (err) {
      setHint('failed to load curriculum: ' + escapeHtml(err.message), 'is-error');
    }
  }

  function renderSectionSelect() {
    const sel = els.sectionSelect;
    sel.innerHTML = '';
    const byGroup = new Map();
    for (const s of state.sections) {
      if (!byGroup.has(s.group)) byGroup.set(s.group, { title: s.groupTitle, sections: [] });
      byGroup.get(s.group).sections.push(s);
    }
    for (const [g, group] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
      const og = document.createElement('optgroup');
      og.label = `Section · ${group.title}`;
      for (const s of group.sections) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  }

  async function selectSection(id, startIndex) {
    if (state.completing) return;
    try {
      const res = await api('/api/section/' + encodeURIComponent(id));
      state.currentSectionId = id;
      state.section = res.section;
      state.snippets = res.snippets;
      state.index = startIndex === 'last' ? state.snippets.length - 1 : (Number(startIndex) || 0);
      state.lastPicks = {};
      els.sectionSelect.value = id;
      els.sectionTag.textContent = `Section · ${res.section.groupTitle}`;
      els.drillTitle.textContent = res.section.name;
      els.codeTitle.textContent = res.section.name;
      await loadProgress();
      renderCurrentSnippet();
    } catch (err) {
      setHint('failed to load section: ' + escapeHtml(err.message), 'is-error');
    }
  }

  async function loadProgress() {
    try {
      const res = await api('/api/progress?profile=' + encodeURIComponent(state.profile));
      state.trainedAt = res.trainedAt || 100;
      state.reps = Number(res.sections[state.currentSectionId]) || 0;
      updateRepMeter();
    } catch (_) {
      state.reps = 0;
      updateRepMeter();
    }
  }

  // ---- profile / user identity -----------------------------------------
  function showProfileModal() {
    els.profileModal.classList.remove('is-hidden');
    els.profileNameInput.focus();
  }
  function hideProfileModal() {
    els.profileModal.classList.add('is-hidden');
  }

  async function loadProfile() {
    try {
      const res = await api('/api/profile');
      if (res.name) {
        state.profile = res.name;
        els.profileInput.value = res.name;
        hideProfileModal();
        return true;
      }
    } catch (_) {}
    state.profile = '';
    showProfileModal();
    return false;
  }

  async function saveProfile(rawName) {
    const name = String(rawName || '').trim();
    if (!name) {
      showProfileModal();
      return;
    }
    try {
      const res = await api('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      state.profile = res.name;
      els.profileInput.value = res.name;
      hideProfileModal();
      await loadProgress();
      renderScorecard();
      els.codeArea.focus();
    } catch (err) {
      setHint('failed to save name: ' + escapeHtml(err.message), 'is-error');
    }
  }

  async function resetAll() {
    if (!window.confirm('Reset ALL progress and your name? This cannot be undone.')) return;
    try {
      await api('/api/wipe', { method: 'POST' });
      state.profile = '';
      els.profileInput.value = '';
      els.profileNameInput.value = '';
      state.reps = 0;
      updateRepMeter();
      renderScorecard();
      showProfileModal();
    } catch (err) {
      setHint('failed to reset: ' + escapeHtml(err.message), 'is-error');
    }
  }

  // ---- scorecard --------------------------------------------------------
  async function renderScorecard() {
    try {
      const res = await api('/api/progress?profile=' + encodeURIComponent(state.profile));
      const trainedAt = res.trainedAt || 100;
      const repsMap = res.sections || {};

      const byGroup = new Map();
      for (const s of state.sections) {
        if (!byGroup.has(s.group)) byGroup.set(s.group, { title: s.groupTitle, sections: [] });
        byGroup.get(s.group).sections.push(s);
      }

      els.scBody.innerHTML = '';
      let trainedCount = 0;
      let totalReps = 0;

      for (const [g, group] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
        const chap = document.createElement('div');
        chap.className = 'sc-group';
        const title = document.createElement('div');
        title.className = 'sc-group__title';
        title.textContent = `Section · ${group.title}`;
        chap.appendChild(title);

        for (const s of group.sections) {
          const reps = Number(repsMap[s.id]) || 0;
          const trained = reps >= trainedAt;
          if (trained) trainedCount++;
          totalReps += reps;

          const row = document.createElement('div');
          row.className = 'sc-row';

          const name = document.createElement('div');
          name.className = 'sc-row__name';
          name.textContent = s.name;

          const barWrap = document.createElement('div');
          barWrap.className = 'bar';
          const fill = document.createElement('div');
          fill.className = 'bar__fill' + (trained ? ' is-trained' : '');
          fill.style.width = Math.min(100, Math.round((reps / trainedAt) * 100)) + '%';
          barWrap.appendChild(fill);

          const repsEl = document.createElement('div');
          repsEl.className = 'sc-row__reps';
          repsEl.textContent = `${reps} / ${trainedAt}`;

          const stateEl = document.createElement('div');
          stateEl.className = 'sc-row__state' + (trained ? ' is-trained' : '');
          stateEl.textContent = trained ? '✦ trained' : 'drilling';

          row.appendChild(name);
          row.appendChild(barWrap);
          row.appendChild(repsEl);
          row.appendChild(stateEl);
          chap.appendChild(row);
        }
        els.scBody.appendChild(chap);
      }

      els.scSummary.textContent = `${trainedCount} trained · ${totalReps.toLocaleString()} total reps`;
    } catch (err) {
      els.scBody.innerHTML = `<div class="sc-empty">failed to load progress: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ---- views ------------------------------------------------------------
  function switchView(view) {
    currentView = view;
    els.navBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    els.views.forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + view));
    if (view === 'scorecard') renderScorecard();
    else els.codeArea.focus();
  }

  // ---- keyboard sound ---------------------------------------------------
  let audioCtx = null;
  let keySoundBuffer = null;
  let keySlices = [];
  let soundOn = localStorage.getItem('odin.sound') !== 'off';

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  async function loadKeySound() {
    try {
      const cfg = await (await fetch('/thock/config.json')).json();
      const src = cfg.sound || 'sound.ogg';
      const defines = cfg.defines || {};
      keySlices = Object.values(defines)
        .filter((d) => Array.isArray(d) && d.length >= 2 && d[1] > 0)
        .map((d) => ({ start: d[0] / 1000, dur: d[1] / 1000 }));
      if (!keySlices.length) return;
      const ctx = ensureAudio();
      if (!ctx) return;
      const res = await fetch('/thock/' + src);
      const arrayBuf = await res.arrayBuffer();
      keySoundBuffer = await ctx.decodeAudioData(arrayBuf);
    } catch {
      keySoundBuffer = null;
      keySlices = [];
    }
  }

  function playThock() {
    if (!soundOn) return;
    const ctx = ensureAudio();
    if (!ctx || !keySoundBuffer || !keySlices.length) return;
    const slice = keySlices[(Math.random() * keySlices.length) | 0];
    const src = ctx.createBufferSource();
    src.buffer = keySoundBuffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.75;
    src.connect(gain).connect(ctx.destination);
    src.start(0, slice.start, slice.dur + 0.02);
  }

  function updateSoundIcon() {
    els.soundIcon.textContent = soundOn ? '🔊' : '🔇';
    els.soundToggle.classList.toggle('is-muted', !soundOn);
    els.soundToggle.title = soundOn ? 'Keyboard sound on' : 'Keyboard sound off';
  }

  // ---- text size --------------------------------------------------------
  function applyFontSize(size) {
    state.fontSize = size;
    els.codeArea.style.fontSize = size + 'px';
    els.fontSizeBtn.textContent = 'A ' + size;
  }
  function cycleFontSize() {
    const idx = FONT_SIZES.indexOf(state.fontSize);
    const next = FONT_SIZES[(idx + 1) % FONT_SIZES.length];
    applyFontSize(next);
    localStorage.setItem('odin.fontSize', String(next));
  }
  function loadFontSize() {
    const saved = Number(localStorage.getItem('odin.fontSize'));
    applyFontSize(FONT_SIZES.includes(saved) ? saved : DEFAULT_FONT_SIZE);
  }

  // ---- music ------------------------------------------------------------
  const audio = new Audio();
  let musicTracks = [];
  let musicIndex = -1;
  let musicHistory = [];
  let musicAutoStarted = false;

  async function loadMusic() {
    try {
      const res = await api('/api/music');
      musicTracks = res.tracks || [];
      if (!musicTracks.length) {
        els.musicField.classList.add('is-hidden');
        return;
      }
      els.musicField.classList.remove('is-hidden');
      musicIndex = (Math.random() * musicTracks.length) | 0;
      const savedVol = localStorage.getItem('odin.volume');
      audio.volume = savedVol === null ? 0.75 : clampVolume(Number(savedVol));
      els.musicVolume.value = String(audio.volume);
      audio.src = musicTracks[musicIndex].url;
      updateMusicUI();
    } catch {
      els.musicField.classList.add('is-hidden');
    }
  }

  function clampVolume(v) {
    if (!Number.isFinite(v)) return 0.75;
    return Math.min(1, Math.max(0, v));
  }
  function updateMusicUI() {
    if (!musicTracks.length) return;
    els.musicTitle.textContent = musicTracks[musicIndex].name;
    els.musicToggle.textContent = audio.paused ? '▶' : '⏸';
    els.musicPlayer.classList.toggle('is-playing', !audio.paused);
  }
  function playMusic() { audio.play().catch(() => {}); }
  // Auto-start the music on the first keystroke (a user gesture), so browser
  // autoplay policies are satisfied without the user having to click play.
  function maybeAutoStartMusic() {
    if (musicAutoStarted) return;
    musicAutoStarted = true;
    if (musicTracks.length && audio.paused) playMusic();
  }
  function loadTrack() {
    audio.src = musicTracks[musicIndex].url;
    playMusic();
    updateMusicUI();
  }
  function toggleMusic() {
    if (audio.paused) playMusic();
    else audio.pause();
    updateMusicUI();
  }
  function nextTrack() {
    if (!musicTracks.length) return;
    musicHistory.push(musicIndex);
    if (musicTracks.length === 1) musicIndex = 0;
    else {
      let next;
      do { next = (Math.random() * musicTracks.length) | 0; } while (next === musicIndex);
      musicIndex = next;
    }
    loadTrack();
  }
  function prevTrack() {
    if (!musicTracks.length) return;
    musicIndex = musicHistory.length ? musicHistory.pop() : (musicIndex - 1 + musicTracks.length) % musicTracks.length;
    loadTrack();
  }

  // ---- keyboard ---------------------------------------------------------
  function typeIndent() {
    if (state.pos >= flat.length) return;
    let n = 0;
    while (n < TAB_WIDTH && state.pos + n < flat.length && flat[state.pos + n] === ' ') n++;
    if (n === 0) return;
    playThock();
    for (let i = 0; i < n; i++) {
      charState[state.pos] = 'correct';
      state.pos += 1;
    }
    updateCaret();
    checkComplete();
  }

  function onKeyDown(e) {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (currentView !== 'drill') return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      restartSnippet();
      return;
    }
    if (e.key === 'Escape') {
      skip();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.completing) return;

    maybeAutoStartMusic();

    if (e.key === 'Tab') {
      e.preventDefault();
      typeIndent();
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (state.pos === 0) return;
      playThock();
      state.pos -= 1;
      charState[state.pos] = 'pending';
      updateCaret();
      return;
    }

    let keyChar = null;
    if (e.key === 'Enter') keyChar = '\n';
    else if (e.key.length === 1) keyChar = e.key;
    if (keyChar === null) return;

    e.preventDefault();
    playThock();

    if (state.pos >= flat.length) return; // ignore keystrokes past the end

    const idx = state.pos;
    const isCorrect = keyChar === flat[idx];
    charState[idx] = isCorrect ? 'correct' : 'incorrect';
    state.pos += 1;
    updateCaret();
    if (!isCorrect) triggerShake(cells[idx]);
    checkComplete();
  }

  // ---- init -------------------------------------------------------------
  function bindEvents() {
    els.navBtns.forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

    els.sectionSelect.addEventListener('change', () => selectSection(els.sectionSelect.value));

    els.restartBtn.addEventListener('click', restartSnippet);
    els.skipBtn.addEventListener('click', skip);
    els.prevBtn.addEventListener('click', () => {
      if (state.completing) return;
      advance(-1);
    });
    els.peekBtn.addEventListener('click', peek);
    els.modeToggle.addEventListener('click', () => {
      if (RECALL_ENABLED) setMode(state.mode === 'recall' ? 'train' : 'recall');
    });

    // Theme switcher: pure CSS-variable swap on <html>, so it never touches
    // trainer state (typing/reps) or the audio element — music keeps playing.
    els.themeSelect.addEventListener('change', () => {
      const theme = els.themeSelect.value;
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('odin.theme', theme);
      els.themeSelect.blur();
    });

    els.codeArea.addEventListener('click', () => els.codeArea.focus());

    document.addEventListener('click', (e) => {
      const el = e.target instanceof Element ? e.target : null;
      const btn = el && el.closest('button');
      if (btn) btn.blur();
    });

    document.addEventListener('keydown', onKeyDown);

    // profile
    els.profileInput.addEventListener('change', () => saveProfile(els.profileInput.value));
    els.profileSaveBtn.addEventListener('click', () => saveProfile(els.profileNameInput.value));
    els.profileNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveProfile(els.profileNameInput.value);
    });
    els.resetBtn.addEventListener('click', resetAll);

    // thock
    els.soundToggle.addEventListener('click', () => {
      soundOn = !soundOn;
      localStorage.setItem('odin.sound', soundOn ? 'on' : 'off');
      updateSoundIcon();
    });

    // text size
    els.fontSizeBtn.addEventListener('click', cycleFontSize);

    // music
    els.musicToggle.addEventListener('click', toggleMusic);
    els.musicNext.addEventListener('click', nextTrack);
    els.musicPrev.addEventListener('click', prevTrack);
    els.musicVolume.addEventListener('input', () => {
      audio.volume = clampVolume(Number(els.musicVolume.value));
      localStorage.setItem('odin.volume', String(audio.volume));
    });
    els.musicVolume.addEventListener('change', () => els.musicVolume.blur());
    audio.addEventListener('ended', nextTrack);
    audio.addEventListener('play', () => { musicAutoStarted = true; updateMusicUI(); });
    audio.addEventListener('pause', updateMusicUI);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    loadFontSize();
    updateSoundIcon();
    els.themeSelect.value = document.documentElement.getAttribute('data-theme') || 'abyss';
    const savedMode = localStorage.getItem('odin.mode');
    if (RECALL_ENABLED) {
      setMode(savedMode === 'train' ? 'train' : 'recall');
    } else {
      setMode('train');
      els.modeToggle.closest('.field').classList.add('is-hidden');
    }
    loadMusic();
    loadKeySound();
    await loadProfile();
    await loadCurriculum();
  });
})();
