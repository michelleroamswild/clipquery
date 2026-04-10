export interface ParsedClip {
  clipNumber: number;
  label: string;
  durationSec: number;
  searchQuery: string;
  overlayText: string | null;
  rawText: string;
}

const STOP_WORDS = new Set([
  // Standard stop words
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "of", "in", "to",
  "for", "with", "on", "at", "from", "by", "about", "as", "into",
  "through", "during", "before", "after", "above", "below", "between",
  "out", "off", "over", "under", "again", "further", "then", "once",
  "that", "this", "these", "those", "it", "its", "and", "but", "or",
  "nor", "not", "so", "very", "just", "also", "than", "too",
  "feels", "like", "really", "quite", "somewhat", "rather",
  // Clip description filler
  "clip", "kinda", "year", "what", "all", "works",
  // Camera/production terms (not useful for content matching)
  "camera", "slowly", "pans", "pan", "zooms", "zoom", "tilts", "tilt",
  "tracks", "tracking", "dolly", "framed", "framing", "shot", "footage",
  "revealing", "reveals", "casting", "shining", "more",
]);

const DURATION_RE = /~?([\d.]+)\s*s\b/;
// Match overlay text that may span multiple lines — greedy up to last quote
const OVERLAY_RE = /overlay\s+text\s*:\s*"([\s\S]+?)"\s*\.?\s*$/i;

export function parseClipDescriptions(input: string): ParsedClip[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Split on "Clip N:" boundaries, keeping the delimiter
  const parts = trimmed.split(/(?=Clip\s+\d+\s*:)/i);

  const clips: ParsedClip[] = [];

  for (const part of parts) {
    const raw = part.trim();
    if (!raw) continue;

    // Extract clip number
    const clipMatch = raw.match(/^Clip\s+(\d+)\s*:\s*/i);
    if (!clipMatch) continue;

    const clipNumber = parseInt(clipMatch[1], 10);
    const body = raw.slice(clipMatch[0].length);

    // Duration
    const durMatch = body.match(DURATION_RE);
    const durationSec = durMatch ? parseFloat(durMatch[1]) : 0;

    // Overlay text
    const overlayMatch = body.match(OVERLAY_RE);
    const overlayText = overlayMatch ? overlayMatch[1] : null;

    // Build search query: strip duration pattern, overlay text section, stop words
    let cleaned = body;
    if (durMatch) cleaned = cleaned.replace(DURATION_RE, " ");
    // Remove everything from "Overlay text:" onward (overlay content isn't useful for search)
    cleaned = cleaned.replace(/overlay\s+text\s*:[\s\S]*$/i, " ");

    const keywords = cleaned
      .replace(/[.,:;!?(){}[\]"*^~]/g, " ")
      .split(/\s+/)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const kw of keywords) {
      if (!seen.has(kw)) {
        seen.add(kw);
        unique.push(kw);
      }
    }

    clips.push({
      clipNumber,
      label: `Clip ${clipNumber}`,
      durationSec,
      searchQuery: unique.join(" "),
      overlayText,
      rawText: raw,
    });
  }

  return clips;
}
