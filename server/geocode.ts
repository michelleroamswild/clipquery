import { getDb } from "./db/connection.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const RATE_LIMIT_MS = 1100; // Nominatim requires ≤1 req/sec

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
}

function formatLocation(addr: NominatimAddress): string {
  const city = addr.city || addr.town || addr.village || addr.hamlet || addr.county;
  const state = addr.state;
  const parts: string[] = [];
  if (city) parts.push(city);
  if (state && state !== city) parts.push(state);
  if (parts.length === 0 && addr.country) parts.push(addr.country);
  return parts.join(", ");
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&zoom=10`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ClipQuery/1.0" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as NominatimResponse;
  if (!data.address) return null;
  const name = formatLocation(data.address);
  return name || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Geocode up to `batchSize` items that have GPS but no location_name.
 * Returns the number of items processed.
 */
export async function geocodeBatch(batchSize = 50): Promise<number> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, latitude, longitude FROM media_items
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND location_name IS NULL
       LIMIT ?`
    )
    .all(batchSize) as { id: number; latitude: number; longitude: number }[];

  if (rows.length === 0) return 0;

  const update = db.prepare("UPDATE media_items SET location_name = ? WHERE id = ?");
  let processed = 0;

  for (const row of rows) {
    const name = await reverseGeocode(row.latitude, row.longitude);
    if (name) {
      update.run(name, row.id);
    } else {
      // Mark as empty string so we don't retry
      update.run("", row.id);
    }
    processed++;
    if (processed < rows.length) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  return processed;
}

/** Count items that still need geocoding */
export function geocodePending(): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM media_items
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND location_name IS NULL`
    )
    .get() as { count: number };
  return row.count;
}
