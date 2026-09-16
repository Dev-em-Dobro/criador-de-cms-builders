import { z } from "zod";

/**
 * YouTube video references.
 *
 * Videos are never uploaded — they live on YouTube and are stored as a canonical
 * external reference. Any accepted input (`watch`, `youtu.be`, `embed`, `shorts`)
 * is normalised to `{ provider, videoId, url }` so the site always renders from a
 * single, predictable shape.
 */

export interface YouTubeRef {
  provider: "youtube";
  videoId: string;
  url: string;
}

/** YouTube ids are exactly 11 URL-safe base64 chars. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YT_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

/**
 * Parse a YouTube URL into a canonical reference, or `null` when the input is
 * not a well-formed YouTube video URL.
 */
export function normalizeYouTube(input: string): YouTubeRef | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let id: string | null = null;

  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (YT_HOSTS.has(host)) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else {
      const m = url.pathname.match(/^\/(?:embed|shorts|v)\/([^/]+)/);
      if (m) id = m[1];
    }
  }

  if (!id || !VIDEO_ID.test(id)) return null;
  return {
    provider: "youtube",
    videoId: id,
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

/**
 * Canonical privacy-preserving embed URL for a YouTube link, or `null` when the
 * input is not a valid YouTube video URL.
 *
 * Used in two places that must agree: the rich-text editor inserts this as an
 * `<iframe>` src, and the server sanitiser rewrites any inline video iframe to
 * exactly this shape (see `lib/content/sanitize.ts`). `youtube-nocookie.com`
 * avoids setting tracking cookies until the viewer actually plays the video.
 */
export function youtubeEmbedUrl(input: string): string | null {
  const ref = normalizeYouTube(input);
  return ref
    ? `https://www.youtube-nocookie.com/embed/${ref.videoId}`
    : null;
}

/** Zod shape of an already-normalised reference (for the re-validation pass). */
const youtubeRefSchema = z.object({
  provider: z.literal("youtube"),
  videoId: z.string().regex(VIDEO_ID),
  url: z.string(),
});

/**
 * Optional content field for a YouTube link.
 *
 * Accepts either a raw URL string (which it normalises) or an already-normalised
 * reference (so publish-time re-validation and translation copies round-trip).
 * A blank input is "not provided"; a malformed / non-YouTube URL is rejected
 * with a specific message.
 */
export const youtubeField = z
  .union([z.string(), youtubeRefSchema])
  .optional()
  .transform((v, ctx) => {
    if (v == null || v === "") return undefined;
    if (typeof v !== "string") return v; // already canonical
    const ref = normalizeYouTube(v);
    if (!ref) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid or non-YouTube video URL",
      });
      return z.NEVER;
    }
    return ref;
  });
