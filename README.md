# odin trainer

A dark-wave / goth / coldwave **muscle-memory trainer for the Odin programming
language**. Instead of racing a timer, you drill small, curated code snippets
until the boilerplate and syntax live in your fingers — then a persistent
scorecard marks each section **trained** once you've logged 100 clean reps.

- **72 sections · 332 drills · 2,629 varied examples** spanning the whole language
- Copy-mode typing with a **variation bank** (a different example each pass)
- Persistent **scorecard** with per-section progress bars
- **8 dark themes**, bundled **music**, and the **thock** keyboard sound
- A **single Linux executable** that self-provisions its data folder

---

## Quick start (run from source)

**Requirements:** [Node.js](https://nodejs.org) ≥ 18. No other runtime
dependencies — the server uses only Node built-ins.

```bash
npm start          # node server/index.js
```

Open **http://localhost:8080** (set `PORT` to change the port). The server opens
your browser automatically — set `ODIN_NO_OPEN=1` to suppress that.

---

## Install the Linux executable

Download **`bin/linux-x64/odin-trainer`**, then:

```bash
chmod +x odin-trainer
sudo mv odin-trainer /usr/local/bin/odin-trainer
odin-trainer
```

It opens your browser and creates **`~/.odin-trainer/`** on first run — there is
no installer and nothing to create by hand. (You can also just run it from any
folder: `./odin-trainer`.)

---

## Building the executables yourself

**Requirements:**

- [Bun](https://bun.sh) ≥ 1.x — the compiler that produces the standalone binary
- Node.js ≥ 18 — runs the build scripts

```bash
npm run build          # full pipeline: regenerate curriculum → embed assets → compile
npm run build:linux    # embed assets → compile Linux x64 → bin/linux-x64/odin-trainer
```

Both compile to **`bin/linux-x64/odin-trainer`**. The build embeds the
curriculum, frontend, thock sound, and your `music/` into the binary, so the
only thing it writes at runtime is your progress.

**Cross-compiling:** append a target, e.g.
`bun build --compile server/index.js --target=bun-windows-x64 --outfile bin/windows-x64/odin-trainer.exe`
or `--target=bun-darwin-arm64`. Smoke-test on the target OS before publishing.

---

## The app, part by part

### Drill view (the main screen)

Top bar, left to right:

| control | what it does |
| --- | --- |
| **brand / logo** | decorative |
| **drill · scorecard** | switch between the two views |
| **theme dropdown** | 8 color themes (Abyss, Bloodmoon, Emerald Crypt, Grave Blue, Ashen, Candlelight, Dark Rose, Plague) — pure CSS swap, never interrupts typing or music |
| **section dropdown** | pick the topic you're drilling, grouped by `Section` |
| **text** (`A 20.5`) | cycle the typing font size |
| **thock** (🔊) | toggle the keyboard click sound |
| **vibe** (music player) | play/pause, prev/next, volume — tracks auto-advance and start on your first keystroke |

Drill area:

- **Section tag + title** — e.g. `Section · Variables` / `Declaring variables`.
- **reps meter** — current section's reps out of 100, plus a `✦ trained` badge.
- **snippet x / y** — which drill of the section you're on.
- **Prompt bar** — a short instruction describing the concept (never typed).
- **Code area** — the snippet you type.

Buttons under the code area:

| button | key | what it does |
| --- | --- | --- |
| **← previous** | — | go to the previous drill (crosses into the previous section) |
| **👁 peek** | — | *(hidden — recall mode is disabled for now)* |
| **↻ restart snippet** | `Ctrl`+`R` | reset the current snippet to a clean state |
| **skip →** | `Esc` | skip to the next drill **without** earning a rep |

### Typing mechanics

- `Tab` indents, `Backspace` walks back to fix a mistake, `Enter` is a newline.
- A snippet is **complete** the moment you reach the end with every character
  correct — it auto-submits with a **+1 rep** flash (no `Enter` required).
- Reach the end with mistakes still showing? It won't submit — back up and fix
  them, then it counts.
- Each drill has a **bank of 5–10 varied examples**; the app picks one per
  encounter and never repeats a variant back-to-back, so you practice the same
  shape with different identifiers/values.

### Scorecard view

- **acolyte** input — your username (also set by the first-run prompt).
- **reset progress** button — wipes all progress and your name (with a confirm).
- One row per section: name, a progress bar, `reps / 100`, and a `✦ trained` /
  `drilling` state, grouped by `Section`.

### First-run username prompt

On first launch (no profile saved) a **"welcome, acolyte"** dialog asks for a
name. That name is stored server-side and used as the key for your progress.
Every later launch skips the prompt.

### Scoring

| term | meaning |
| --- | --- |
| **rep** | one clean (100% correct) completion of a snippet |
| **section** | a self-contained drill topic |
| **trained** | a section whose rep count reaches `TRAINED_AT` (100 by default, in `server/progress.js`) |

### User data folder

On first run the app creates **`~/.odin-trainer/`** (hidden — the leading dot):

| file | contents |
| --- | --- |
| `profile.json` | your username |
| `progress.json` | reps per section |

Set `ODIN_DATA_DIR=/some/path` to relocate it (handy for tests). Deleting the
folder (or using **reset progress**) returns you to a fresh, first-run state.

### Music & keyboard sound

- `music/` — drop your own `.mp3`/`.wav`/`.ogg`/`.flac`/`.m4a` files here; they're
  scanned at startup and bundled into the executable at build time.
- `thock/` — the keyboard sound pack (`config.json` + `sound.ogg`).

---

## Curriculum

```
curriculum/
  03-01-declaring-variables/
    section.json   -> { name, group, groupTitle, order,
                        snippets: [ { instruction, targets: [...] }, ... ] }
```

| field | meaning |
| --- | --- |
| `instruction` | short natural-language task (shown in the prompt bar) |
| `targets` | 5–10 equivalent Odin snippets (one is picked per encounter) |

Each section is a **self-contained folder** — to add a new Odin topic, drop in a
folder with a `section.json` (the running dev server watches the tree; hit
`GET /api/reload` to refresh).

Generated at build time by:

- `scripts/build-curriculum.mjs` — the curated base drills + the variation engine
- `scripts/vary.mjs` — identifier/literal variation + instruction genericizer
- `scripts/build-embedded.mjs` — bundles all assets into `server/embedded.mjs`

`server/embedded.mjs` is a generated snapshot (≈50 MB, music included) that is
kept in the repo so `npm start` works out of the box; `npm run build:linux`
regenerates it before compiling.

---

## API

| route | description |
| --- | --- |
| `GET /api/health` | liveness check |
| `GET /api/curriculum` | section metadata (no snippet bodies) |
| `GET /api/section/:id` | one section incl. `targets` arrays |
| `GET /api/profile` | the active username (`""` if unset) |
| `POST /api/profile` | `{ name }` — set the active username |
| `POST /api/wipe` | clear profile + progress (start over) |
| `GET /api/progress?profile=…` | rep counts per section + `trainedAt` |
| `POST /api/reps` | `{ profile, section }` — +1 clean rep |
| `POST /api/reset` | `{ profile, section }` — zero one section |
| `GET /api/reload` | re-read the curriculum tree (dev) |
| `GET /api/music` | list bundled/drop-in tracks |

---

## Project layout

```
bin/               # compiled executables (linux-x64/odin-trainer, …)
server/            # zero-dependency server
  index.js           # HTTP + API + static/music/thock serving
  curriculumLoader.js
  progress.js        # rep persistence (progress.json)
  embedded.mjs       # generated asset bundle (keep committed)
public/            # frontend
  index.html
  css/style.css
  js/app.js
  assets/logo.svg
curriculum/        # self-contained drill sections
music/             # bundled music
thock/             # keyboard sound pack
scripts/           # build tools (curriculum, vary, embedded, extract)
```

---

## Notes

- A **recall mode** ("type from memory" with a peek button) is implemented but
  disabled behind `RECALL_ENABLED` in `public/js/app.js` — it needs a
  per-declaration-type rule engine before it's fair for arbitrary Odin. Flip the
  flag to revisit it.
- `scripts/extract-book.mjs` / `scripts/book-extract.json` are one-off artifacts
  from the original corpus build and aren't needed at runtime.

---

## Vibecode Stats

Built with `deepseek-v4-pro` via the DeepSeek Harness (`deepseek-official`
provider, ~240 model calls).

| Token type | Count |
| --- | --- |
| Fresh input (prompt) | 431,106 |
| Cached input (context re-read) | 188,936,448 |
| Output (completion) | 1,027,028 |
| Reasoning (thinking) | 709,040 |
| **Grand total** | **190,394,582** |

- **Cache-hit rate:** ~99.77% (`188,936,448` cached / `189,367,554` total input)
- Output split: ~709k reasoning + ~318k visible text / tool calls.
- No `v4-flash` was used on this project (that was the earlier `vibetyper` build).

