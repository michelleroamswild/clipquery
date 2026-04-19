/**
 * CLIP visual embeddings — index the cached photo/video thumbnails into a
 * semantic vector space so we can search by natural language against pixels.
 *
 * Uses @xenova/transformers (WASM ONNX runtime) to run clip-vit-base-patch32
 * locally, no GPU, no Python. Vectors are L2-normalized Float32 (512-dim) and
 * stored in ai_artifacts as base64 under kind='clip_embedding_v1'.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/connection.js";
import { processWithConcurrency } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBNAILS_DIR = path.resolve(__dirname, "../../data/thumbnails");

const MODEL_NAME = "Xenova/clip-vit-base-patch32";
const EMBEDDING_KIND = "clip_embedding_v1";
const EMBEDDING_DIM = 512;
const BATCH_SIZE = 32;
const CONCURRENCY = 2; // ONNX inference is CPU-heavy; small parallelism helps overlap I/O

// ── Pipeline bootstrap (lazy, shared) ──────────────────────────

interface ClipPipeline {
  imageFeatures: (imagePath: string) => Promise<Float32Array>;
  textFeatures: (text: string) => Promise<Float32Array>;
}

let pipelinePromise: Promise<ClipPipeline> | null = null;

async function getPipeline(): Promise<ClipPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const tr = (await import("@xenova/transformers")) as unknown as {
      env: { allowLocalModels: boolean };
      AutoProcessor: { from_pretrained: (name: string) => Promise<(input: unknown) => Promise<{ pixel_values: unknown }>> };
      AutoTokenizer: { from_pretrained: (name: string) => Promise<(texts: string[], opts?: unknown) => unknown> };
      CLIPVisionModelWithProjection: { from_pretrained: (name: string) => Promise<(input: { pixel_values: unknown }) => Promise<{ image_embeds: { data: Float32Array } }>> };
      CLIPTextModelWithProjection: { from_pretrained: (name: string) => Promise<(input: unknown) => Promise<{ text_embeds: { data: Float32Array } }>> };
      RawImage: { read: (src: string) => Promise<unknown> };
    };
    tr.env.allowLocalModels = false;

    const [visionModel, textModel, processor, tokenizer] = await Promise.all([
      tr.CLIPVisionModelWithProjection.from_pretrained(MODEL_NAME),
      tr.CLIPTextModelWithProjection.from_pretrained(MODEL_NAME),
      tr.AutoProcessor.from_pretrained(MODEL_NAME),
      tr.AutoTokenizer.from_pretrained(MODEL_NAME),
    ]);

    const imageFeatures = async (imagePath: string): Promise<Float32Array> => {
      const image = await tr.RawImage.read(imagePath);
      const { pixel_values } = await processor(image);
      const { image_embeds } = await visionModel({ pixel_values });
      return l2Normalize(new Float32Array(image_embeds.data));
    };

    const textFeatures = async (text: string): Promise<Float32Array> => {
      const inputs = tokenizer([text], { padding: true, truncation: true });
      const { text_embeds } = await textModel(inputs);
      return l2Normalize(new Float32Array(text_embeds.data));
    };

    return { imageFeatures, textFeatures };
  })();
  return pipelinePromise;
}

function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

// ── Storage helpers ────────────────────────────────────────────

export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

export function decodeVector(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  // Copy into a fresh ArrayBuffer so byteOffset is 0 and length lines up.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

// ── Which file to embed ────────────────────────────────────────

/** Return the cached thumbnail path for a media item, if one exists on disk. */
function thumbnailPathFor(item: { id: number; type: string }): string | null {
  const videoThumb = path.join(THUMBNAILS_DIR, `${item.id}.jpg`);
  const photoThumb = path.join(THUMBNAILS_DIR, `photo-${item.id}.jpg`);
  if (item.type === "video" && fs.existsSync(videoThumb)) return videoThumb;
  if (item.type === "photo" && fs.existsSync(photoThumb)) return photoThumb;
  return null;
}

// ── Single-item embedding ──────────────────────────────────────

export async function embedOne(
  pipeline: ClipPipeline,
  item: { id: number; type: string }
): Promise<Float32Array | null> {
  const thumb = thumbnailPathFor(item);
  if (!thumb) return null;
  const vec = await pipeline.imageFeatures(thumb);
  if (vec.length !== EMBEDDING_DIM) {
    throw new Error(`unexpected embedding dim: ${vec.length}`);
  }
  return vec;
}

// ── Batch generator ────────────────────────────────────────────

export interface EmbedResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  remaining: number;
}

export async function generateEmbeddings(volume?: string): Promise<EmbedResult> {
  const db = getDb();

  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params: (string | number)[] = volume ? [volume, BATCH_SIZE] : [BATCH_SIZE];
  const items = db
    .prepare(
      `SELECT id, type FROM media_items
       WHERE clip_state IN ('not_started', 'queued')${volumeClause}
       LIMIT ?`
    )
    .all(...params) as { id: number; type: string }[];

  if (items.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, remaining: countPending(volume) };
  }

  const pipeline = await getPipeline();

  const markQueued = db.prepare("UPDATE media_items SET clip_state = 'queued' WHERE id = ?");
  db.transaction(() => {
    for (const item of items) markQueued.run(item.id);
  })();

  const markDone = db.prepare("UPDATE media_items SET clip_state = 'done' WHERE id = ?");
  const markError = db.prepare("UPDATE media_items SET clip_state = 'error' WHERE id = ?");
  const markSkipped = db.prepare("UPDATE media_items SET clip_state = 'not_started' WHERE id = ?");
  const deleteExisting = db.prepare(
    `DELETE FROM ai_artifacts WHERE media_item_id = ? AND kind = '${EMBEDDING_KIND}'`
  );
  const insertArtifact = db.prepare(
    `INSERT INTO ai_artifacts (media_item_id, kind, json) VALUES (?, '${EMBEDDING_KIND}', ?)`
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  await processWithConcurrency(items, CONCURRENCY, async (item) => {
    try {
      const vec = await embedOne(pipeline, item);
      if (!vec) {
        // No cached thumbnail → leave it for a later run, don't mark error
        markSkipped.run(item.id);
        skipped++;
        return;
      }
      db.transaction(() => {
        deleteExisting.run(item.id);
        insertArtifact.run(item.id, JSON.stringify({ vector: encodeVector(vec), dim: EMBEDDING_DIM }));
        markDone.run(item.id);
      })();
      succeeded++;
    } catch (err) {
      console.error(`CLIP embed failed for id=${item.id}: ${(err as Error).message}`);
      markError.run(item.id);
      failed++;
    }
  });

  return { processed: items.length, succeeded, failed, skipped, remaining: countPending(volume) };
}

function countPending(volume?: string): number {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [volume] : [];
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE clip_state IN ('not_started', 'queued')${volumeClause}`
    )
    .get(...params) as { count: number };
  return row.count;
}

export interface ClipStatus {
  pending: number;
  queued: number;
  done: number;
  error: number;
}

export function clipStatus(volume?: string): ClipStatus {
  const db = getDb();
  const volumeClause = volume ? " AND volume_name = ?" : "";
  const params = volume ? [volume] : [];
  const rows = db
    .prepare(
      `SELECT clip_state, COUNT(*) as count FROM media_items
       WHERE 1=1${volumeClause}
       GROUP BY clip_state`
    )
    .all(...params) as { clip_state: string; count: number }[];

  const counts: ClipStatus = { pending: 0, queued: 0, done: 0, error: 0 };
  for (const row of rows) {
    if (row.clip_state === "not_started") counts.pending = row.count;
    else if (row.clip_state === "queued") counts.queued = row.count;
    else if (row.clip_state === "done") counts.done = row.count;
    else if (row.clip_state === "error") counts.error = row.count;
  }
  return counts;
}

// ── Query helpers (for the semantic search route) ──────────────

export async function embedQueryText(query: string): Promise<Float32Array> {
  const pipeline = await getPipeline();
  return pipeline.textFeatures(query);
}

/** Load all stored embeddings with their media_item_id for brute-force search. */
export function loadAllEmbeddings(): { id: number; vec: Float32Array }[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT media_item_id as id, json FROM ai_artifacts WHERE kind = '${EMBEDDING_KIND}'`
    )
    .all() as { id: number; json: string }[];
  return rows.map((r) => {
    const parsed = JSON.parse(r.json) as { vector: string };
    return { id: r.id, vec: decodeVector(parsed.vector) };
  });
}
