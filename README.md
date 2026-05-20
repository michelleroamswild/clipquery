# clipquery

A local-first media indexer and visual search tool for large personal photo & video libraries. Scans mounted drives, extracts EXIF, generates thumbnails, geocodes GPS data, and runs a local vision-language model (LLaVA via Ollama) to describe and tag scenes. Everything stays on your machine — no cloud, no upload.

See [`DESIGN.md`](./DESIGN.md) for the design system and product philosophy.

## Requirements

- **macOS** — uses `/Volumes/` semantics, `open -R` for Finder reveal, and macOS volume detection. Linux/Windows would need adapters in `server/indexer/volume.ts` and `server/api/routes/media.ts`.
- **Node.js 18+** and `npm` — [install via `nvm`](https://github.com/nvm-sh/nvm#installing-and-updating).
- **ffmpeg** — extracts video poster frames and scales photo thumbnails. `brew install ffmpeg`.
- **exiftool** — pulls embedded JPEG previews from RAW formats (ARW, NEF, CR2/3, DNG, etc.). `brew install exiftool`.
- **Ollama** (optional but recommended) — runs the vision-language model used for scene descriptions and auto-tagging. Without it, indexing and search still work, but the AI Analysis pipeline is disabled. Install from [ollama.com](https://ollama.com/), then pull the default model:
  ```sh
  ollama pull llava:13b
  ```

## Setup

```sh
git clone <your fork or this repo>
cd clipquery
npm install
```

Start both the Vite dev server (UI on `http://localhost:8080`) and the Express API (`http://localhost:3001`) together:

```sh
npm run dev:all
```

Or run them separately:

```sh
npm run dev          # UI only
npm run dev:server   # API only
```

The SQLite database and generated thumbnails live in `./data/` and are git-ignored.

## First-run flow

1. Open `http://localhost:8080` and use the sidebar to scan a directory (a mounted external drive, your `~/Pictures` folder, etc.). The scan walks the tree and inserts file metadata.
2. From the **Files** page, run **Generate thumbnails** / **Generate photo previews** to populate the grid.
3. With Ollama running, click **AI Analyze** to start the LLaVA worker. Progress is streamed back to the UI; you can stop it any time.
4. Click any row to inspect the file — the right pane shows hardware `[HW]`, machine `[ML]`, and user `[USER]` provenance per field.

## Changing the LLM

The default model is `llava:13b`. To swap it:

1. Pull whatever vision-capable Ollama model you want — `llava:7b` (faster, less detail), `llava:34b` (slower, better), `bakllava`, `moondream`, `llava-llama3`, etc.
   ```sh
   ollama pull llava:7b
   ```
2. Edit `server/indexer/llava-analyze.ts` and change the `MODEL` constant:
   ```ts
   const MODEL = "llava:7b";   // line ~13
   ```
3. Restart the server (`npm run dev:server`). Existing analyses are kept; new runs use the new model. Re-analyze any file from the inspector if you want it re-described.

The Ollama endpoint is configurable via env var (useful if Ollama runs on another machine on your LAN):

```sh
OLLAMA_BASE_URL=http://192.168.1.50:11434 npm run dev:server
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev:all` | UI + API together (concurrently) |
| `npm run dev` | Vite UI only |
| `npm run dev:server` | Express API with `tsx watch` auto-reload |
| `npm run build` | Production UI build to `dist/` |
| `npm run index -- <path>` | CLI scan of a directory (alternative to UI scanning) |
| `npm run analyze` | CLI batch run of LLaVA over un-analyzed items |
| `npm test` | Vitest test suite |
| `npm run lint` | ESLint |

## Stack

- **UI:** Vite + React 18 + TypeScript, Tailwind CSS, shadcn/Radix, TanStack Query, react-leaflet for the map, recharts for the dashboard.
- **API:** Express 5 on Node 18, `better-sqlite3` for storage.
- **Indexer:** Node CLI scripts in `server/indexer/` — file walker, EXIF parser (`exifr`), thumbnail pipeline (`ffmpeg` + `exiftool` fallback for RAW), Ollama-backed analyzer.
- **Storage:** Single SQLite file at `data/clipquery.db`. FTS5 indexes for filename + description text search.

## Data & privacy

Nothing leaves your machine. The Ollama call is local-only (`localhost:11434`). Geocoding hits Nominatim (OpenStreetMap) for reverse-geocoding GPS coordinates — that's the only external network call, and it can be disabled by skipping the geocode step. The basemap tiles in the GPS map view come from CARTO's public dark tile server.

The SQLite DB, thumbnails, and any cached previews all live in `./data/`. Delete the directory to reset.
