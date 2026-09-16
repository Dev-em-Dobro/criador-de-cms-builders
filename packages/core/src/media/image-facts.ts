import sharp from "sharp";
import type { ImageFacts } from "./policies.js";

/**
 * Read format/dimension/alpha facts from raw image bytes with sharp. Must run on
 * the ORIGINAL upload, before any WebP re-encode — otherwise format and alpha
 * would reflect the processed copy, not what the author actually submitted.
 * Falls back to size-only facts for anything sharp can't decode (e.g. SVG).
 */
export async function readImageFacts(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ImageFacts> {
  try {
    const m = await sharp(bytes, { failOn: "none" }).metadata();
    return {
      mimeType,
      sizeBytes: bytes.byteLength,
      width: m.width,
      height: m.height,
      hasAlpha: m.hasAlpha,
    };
  } catch {
    return { mimeType, sizeBytes: bytes.byteLength };
  }
}
