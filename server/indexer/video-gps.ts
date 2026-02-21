import fs from "node:fs";
import type { GpsCoords } from "./exif.js";

/**
 * Extract GPS from MP4/MOV files by reading the ©xyz atom
 * inside moov > udta. The atom contains a string like:
 *   "+37.7749-122.4194/"
 *   "+37.7749-122.4194+025.000/"
 */

const XYZ_TYPE = Buffer.from("\xA9xyz"); // ©xyz

/**
 * Parse MP4/MOV atoms to find moov > udta > ©xyz.
 * Only reads headers + the tiny ©xyz payload, so it's fast even for large files.
 */
export async function extractVideoGps(absolutePath: string): Promise<GpsCoords | null> {
  let fd: number | null = null;
  try {
    fd = fs.openSync(absolutePath, "r");
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;

    // Find the moov atom at the top level
    const moovOffset = findAtom(fd, 0, fileSize, "moov");
    if (moovOffset === null) return null;

    const moovSize = readAtomSize(fd, moovOffset);
    if (moovSize === null) return null;

    // Find udta inside moov
    const udtaOffset = findAtom(fd, moovOffset + 8, moovOffset + moovSize, "udta");
    if (udtaOffset === null) return null;

    const udtaSize = readAtomSize(fd, udtaOffset);
    if (udtaSize === null) return null;

    // Find ©xyz inside udta
    const xyzOffset = findAtomByBuf(fd, udtaOffset + 8, udtaOffset + udtaSize, XYZ_TYPE);
    if (xyzOffset === null) return null;

    const xyzSize = readAtomSize(fd, xyzOffset);
    if (xyzSize === null || xyzSize < 12) return null;

    // Read the ©xyz payload: 2 bytes string length + 2 bytes language code + string
    const payloadBuf = Buffer.alloc(xyzSize - 8);
    fs.readSync(fd, payloadBuf, 0, payloadBuf.length, xyzOffset + 8);

    const strLen = payloadBuf.readUInt16BE(0);
    const gpsStr = payloadBuf.subarray(4, 4 + strLen).toString("utf-8");

    return parseXyzString(gpsStr);
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function readAtomSize(fd: number, offset: number): number | null {
  const buf = Buffer.alloc(4);
  const bytesRead = fs.readSync(fd, buf, 0, 4, offset);
  if (bytesRead < 4) return null;
  return buf.readUInt32BE(0);
}

function readAtomType(fd: number, offset: number): string | null {
  const buf = Buffer.alloc(4);
  const bytesRead = fs.readSync(fd, buf, 0, 4, offset + 4);
  if (bytesRead < 4) return null;
  return buf.toString("ascii");
}

function findAtom(fd: number, start: number, end: number, type: string): number | null {
  let pos = start;
  while (pos + 8 <= end) {
    const size = readAtomSize(fd, pos);
    const atomType = readAtomType(fd, pos);
    if (size === null || atomType === null || size < 8) return null;
    if (atomType === type) return pos;
    pos += size;
  }
  return null;
}

function findAtomByBuf(fd: number, start: number, end: number, typeBuf: Buffer): number | null {
  let pos = start;
  const headerBuf = Buffer.alloc(8);
  while (pos + 8 <= end) {
    const bytesRead = fs.readSync(fd, headerBuf, 0, 8, pos);
    if (bytesRead < 8) return null;
    const size = headerBuf.readUInt32BE(0);
    if (size < 8) return null;
    if (headerBuf.subarray(4, 8).equals(typeBuf)) return pos;
    pos += size;
  }
  return null;
}

/**
 * Parse ISO 6709 style string: "+37.7749-122.4194/" or "+37.7749-122.4194+25.000/"
 */
function parseXyzString(str: string): GpsCoords | null {
  // Match patterns like +DD.DDDD-DDD.DDDD or +DD.DDDD+DDD.DDDD
  const match = str.match(/^([+-]\d+\.?\d*?)([+-]\d+\.?\d*)/);
  if (!match) return null;

  const latitude = parseFloat(match[1]);
  const longitude = parseFloat(match[2]);

  if (isNaN(latitude) || isNaN(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
}
