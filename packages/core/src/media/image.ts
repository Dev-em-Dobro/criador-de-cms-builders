import sharp from "sharp";

/**
 * Server-side image compression. Raster images are re-encoded to WebP and
 * capped in size before they reach Bunny storage; everything else (SVG,
 * animated GIF, and documents) is stored exactly as uploaded.
 */

// Longest-side cap in pixels. Large enough for full-width heroes on retina
// screens, small enough to keep files light.
const MAX_DIMENSION = 2560;
const WEBP_QUALITY = 80;

// Raster formats safe to re-encode. GIF is skipped so animations survive;
// SVG is vector and must not go through a raster pipeline.
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ProcessedUpload {
  bytes: Uint8Array;
  mimeType: string;
  ext: string;
  width: number | null;
  height: number | null;
}

export async function processImage(
  bytes: Uint8Array,
  mimeType: string,
  originalExt: string,
): Promise<ProcessedUpload> {
  if (!COMPRESSIBLE.has(mimeType)) {
    return { bytes, mimeType, ext: originalExt, width: null, height: null };
  }

  try {
    const out = await sharp(bytes, { failOn: "none" })
      .rotate() // bake in EXIF orientation, then metadata is dropped by default
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: new Uint8Array(out.data),
      mimeType: "image/webp",
      ext: "webp",
      width: out.info.width,
      height: out.info.height,
    };
  } catch {
    // Undecodable image — store the original rather than failing the upload.
    return { bytes, mimeType, ext: originalExt, width: null, height: null };
  }
}
