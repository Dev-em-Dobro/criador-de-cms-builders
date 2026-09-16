import sanitizeHtml from "sanitize-html";
import { FIELDS } from "./ui-fields.js";
import type { ContentType } from "./types.js";
import { youtubeEmbedUrl } from "./youtube.js";

/**
 * Rich-text fields hold HTML produced by the Quill editor. Because a separate
 * public site renders that HTML, every value is sanitised on the server before
 * it is persisted — no unsanitised markup ever reaches the database.
 *
 * The allowlist mirrors the editor toolbar (headings, emphasis, lists, quote,
 * link, inline image, YouTube video); anything else — scripts, event handlers,
 * styles — is dropped.
 *
 * Inline images carry only an `src`/`alt`. The src must be http(s): the editor
 * uploads picked images through the media pipeline and inserts the resulting
 * CDN URL, so `data:` (base64) sources are intentionally rejected — they would
 * bloat the row and bypass Bunny.
 *
 * Inline videos are the one exception to "no iframes". An `<iframe>` survives
 * only when its src normalises to a YouTube video; it is then rewritten to a
 * canonical `youtube-nocookie.com/embed/<id>` URL with a fixed attribute set,
 * and any iframe that fails to normalise is dropped whole. This closes the
 * obvious iframe-injection vector while still letting authors embed a video.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "h2",
    "h3",
    "ol",
    "ul",
    "li",
    "a",
    "blockquote",
    "img",
    "iframe",
  ],
  allowedAttributes: {
    a: ["href", "rel"],
    img: ["src", "alt"],
    iframe: ["src", "class", "frameborder", "allowfullscreen"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"], iframe: ["https"] },
  // Defence in depth: even before transformTags rewrites the src, only these
  // hosts are ever accepted for an iframe.
  allowedIframeHostnames: [
    "www.youtube.com",
    "youtube.com",
    "www.youtube-nocookie.com",
    "youtube-nocookie.com",
  ],
  allowIframeRelativeUrls: false,
  allowProtocolRelative: false,
  transformTags: {
    // Force safe rel on every link regardless of what the editor emitted.
    a: (_tag, attribs) => ({
      tagName: "a",
      attribs: { ...attribs, rel: "noopener nofollow" },
    }),
    // Rewrite any surviving iframe to a canonical YouTube embed. A src that
    // does not normalise yields no src, so exclusiveFilter drops the tag.
    iframe: (_tag, attribs) => {
      const embed = youtubeEmbedUrl(attribs.src ?? "");
      const next: Record<string, string> = embed
        ? {
            src: embed,
            class: "ql-video",
            frameborder: "0",
            allowfullscreen: "true",
          }
        : {};
      return { tagName: "iframe", attribs: next };
    },
  },
  // Remove any iframe that transformTags could not turn into a YouTube embed.
  exclusiveFilter: (frame) =>
    frame.tag === "iframe" &&
    !/^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}$/.test(
      frame.attribs.src ?? "",
    ),
};

export function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/** Names of the rich-text fields for a type (single source of truth: FIELDS). */
export function richTextFields(type: string): string[] {
  const fields = FIELDS[type as ContentType] ?? [];
  return fields.filter((f) => f.kind === "richtext").map((f) => f.name);
}

/** Return a copy of `data` with every rich-text field sanitised. */
export function sanitizeRichText(
  type: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...data };
  for (const name of richTextFields(type)) {
    if (typeof out[name] === "string") {
      out[name] = sanitizeRichHtml(out[name] as string);
    }
  }
  return out;
}
