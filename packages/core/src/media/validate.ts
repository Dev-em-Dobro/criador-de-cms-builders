export const ALLOWED_MIME = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  // Documents. Video is intentionally NOT allowed — videos go on YouTube.
  "application/pdf",
  "text/plain", // .txt
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);

// Hint for the browser file picker (the server still validates the real type).
export const ACCEPT_ATTR = "image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx";

export const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export function validateUpload(
  mimeType: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_MIME.has(mimeType)) {
    return { ok: false, error: `Unsupported file type: ${mimeType}` };
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    return {
      ok: false,
      error: `File too large (max ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB)`,
    };
  }
  return { ok: true };
}
