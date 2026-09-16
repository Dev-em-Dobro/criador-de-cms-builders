"use client";

import { useEffect, useRef, useState } from "react";
import "quill/dist/quill.snow.css";
import { youtubeEmbedUrl } from "@cms-core/core/engine";
import { useCoreStrings } from "./strings.js";

// Standard toolbar. Inline images upload through the media pipeline (Bunny) and
// are inserted as CDN URLs — never base64 (the sanitiser drops `data:` sources).
// The `video` button embeds a YouTube link (validated below); the sanitiser
// enforces the same YouTube-only rule on the server.
const TOOLBAR = [
  [{ header: [2, 3, false] }],
  ["bold", "italic", "underline"],
  [{ list: "ordered" }, { list: "bullet" }],
  ["blockquote"],
  ["link", "image", "video"],
  ["clean"],
];

/**
 * Upload one image through POST /api/media and return its delivery URL.
 *
 * `fallbackError` chega de fora porque esta função vive fora do componente —
 * hooks (e portanto o dicionário de textos) não são acessíveis aqui.
 */
async function uploadImage(file: File, fallbackError: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/media", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.fields?.file ?? body.error ?? fallbackError);
  }
  return body.deliveryUrl as string;
}

/**
 * Vanilla Quill 2 wrapped for React. Quill is loaded dynamically inside the
 * effect so it never runs during SSR (it touches `document` on init). The
 * editor is uncontrolled: `value` seeds it on mount and edits flow out via
 * `onChange`. When `resetKey` changes (e.g. after restoring a version), the
 * editor is re-seeded from the current `value` without marking the form dirty.
 */
export default function RichTextEditor({
  value,
  onChange,
  labelledBy,
  describedBy,
  invalid,
  resetKey,
  disabled,
}: {
  value: string;
  onChange: (html: string) => void;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
  resetKey?: number;
  disabled?: boolean;
}) {
  const t = useCoreStrings();
  const containerRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<import("quill").default | null>(null);
  // While true, programmatic content changes must not fire onChange.
  const seedingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  // Latest props kept in refs so the mount effect never needs to re-run.
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const disabledRef = useRef(disabled);
  // Os textos entram pelo mesmo caminho das props: o efeito de montagem roda
  // uma vez e lê o dicionário atual pelo ref, sem virar dependência.
  const stringsRef = useRef(t);
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
    disabledRef.current = disabled;
    stringsRef.current = t;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    (async () => {
      const { default: Quill } = await import("quill");
      if (cancelled) return;

      // Quill replaces this element's contents; a dedicated child keeps our
      // ref div stable for React.
      const editor = document.createElement("div");
      container.appendChild(editor);

      const quill = new Quill(editor, {
        theme: "snow",
        modules: { toolbar: TOOLBAR },
      });
      quillRef.current = quill;

      // Replace Quill's default image handler (which base64-embeds the file)
      // with one that uploads to the media pipeline and inserts the CDN URL.
      const toolbar = quill.getModule("toolbar") as {
        addHandler: (name: string, handler: () => void) => void;
      };
      toolbar.addHandler("image", () => {
        if (disabledRef.current) return;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          setUploading(true);
          setUploadError("");
          try {
            const url = await uploadImage(file, stringsRef.current.uploadFailed);
            const range = quill.getSelection(true);
            const index = range ? range.index : quill.getLength();
            quill.insertEmbed(index, "image", url, "user");
            quill.setSelection(index + 1, 0);
          } catch (err) {
            setUploadError(
              err instanceof Error ? err.message : stringsRef.current.imageUploadFailed,
            );
          } finally {
            setUploading(false);
          }
        };
        input.click();
      });

      // Embed a YouTube video. The default Quill handler would accept any URL;
      // we validate/normalise to a canonical nocookie embed so what the author
      // sees matches what the server sanitiser keeps (non-YouTube is rejected).
      toolbar.addHandler("video", () => {
        if (disabledRef.current) return;
        const input = window.prompt(stringsRef.current.pasteYoutubeUrl);
        if (input == null) return; // cancelled
        const embed = youtubeEmbedUrl(input);
        if (!embed) {
          setUploadError(stringsRef.current.invalidYoutubeUrl);
          return;
        }
        setUploadError("");
        const range = quill.getSelection(true);
        const index = range ? range.index : quill.getLength();
        quill.insertEmbed(index, "video", embed, "user");
        quill.setSelection(index + 1, 0);
      });

      // Embed delete affordance. Selecting an embed to delete it is fiddly in
      // Quill (a video iframe even swallows the click — it is made
      // `pointer-events:none` in the editor for this reason). A floating "×"
      // button follows whichever image/video the pointer is over; clicking it
      // removes that embed. Hit-testing is by bounding box so it works for the
      // non-interactive iframe as well as images.
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", stringsRef.current.removeEmbed);
      removeBtn.style.cssText =
        "position:absolute;z-index:10;display:none;width:36px;height:36px;" +
        "padding:0;border:none;border-radius:9999px;background:#dc2626;" +
        "color:#fff;font-size:24px;line-height:1;cursor:pointer;" +
        "box-shadow:0 1px 4px rgba(0,0,0,.35);";
      quill.container.appendChild(removeBtn);

      let hovered: HTMLElement | null = null;

      const embedAt = (x: number, y: number): HTMLElement | null => {
        const nodes = quill.root.querySelectorAll<HTMLElement>(
          "img, iframe.ql-video",
        );
        for (const el of nodes) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            return el;
          }
        }
        return null;
      };

      const hideRemove = () => {
        removeBtn.style.display = "none";
        hovered = null;
      };

      quill.root.addEventListener("mousemove", (e: MouseEvent) => {
        if (disabledRef.current) return;
        const el = embedAt(e.clientX, e.clientY);
        hovered = el;
        if (!el) {
          removeBtn.style.display = "none";
          return;
        }
        const box = quill.container.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        removeBtn.style.top = `${r.top - box.top + 6}px`;
        removeBtn.style.left = `${r.right - box.left - 42}px`;
        removeBtn.style.display = "";
      });

      // Moving onto the button (a sibling of the editor) must not hide it;
      // leaving the editor for anywhere else does.
      quill.root.addEventListener("mouseleave", (e: MouseEvent) => {
        if (e.relatedTarget !== removeBtn) removeBtn.style.display = "none";
      });
      removeBtn.addEventListener("mouseleave", hideRemove);

      removeBtn.addEventListener("click", () => {
        if (!hovered || disabledRef.current) return;
        const blot = Quill.find(hovered);
        if (!blot) return;
        const index = quill.getIndex(blot as Parameters<typeof quill.getIndex>[0]);
        quill.deleteText(index, 1, "user"); // embeds have length 1
        hideRemove();
      });

      // Paste as plain text only: strip all formatting from clipboard content
      // (Word, web pages, etc.). Runs in the capture phase and stops Quill's own
      // paste handler so it can't re-apply the source's markup. Pasted image
      // *files* carry no `text/plain`, so they are ignored — inline images go
      // through the toolbar button and the media pipeline, never a paste.
      quill.root.addEventListener(
        "paste",
        (e: ClipboardEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const text = (e.clipboardData?.getData("text/plain") ?? "").replace(
            /\r\n?/g,
            "\n",
          );
          const range = quill.getSelection(true);
          if (!range) return;
          if (range.length) quill.deleteText(range.index, range.length, "user");
          if (text) {
            quill.insertText(range.index, text, "user");
            quill.setSelection(range.index + text.length, 0, "user");
          }
        },
        true,
      );

      // Seed existing content (may be legacy plain text or HTML) BEFORE the
      // change listener, so seeding doesn't mark the form dirty.
      if (valueRef.current) {
        quill.clipboard.dangerouslyPasteHTML(valueRef.current);
      }

      if (labelledBy) quill.root.setAttribute("aria-labelledby", labelledBy);
      if (describedBy) quill.root.setAttribute("aria-describedby", describedBy);
      quill.enable(!disabledRef.current); // apply lock state once loaded

      quill.on("text-change", () => {
        if (seedingRef.current) return; // ignore programmatic re-seeds
        // Treat Quill's empty document ("<p><br></p>") as "" so required
        // validation and the unsaved-changes flag match the old textarea. A
        // document with only an image or video embed has no text but is NOT
        // empty — keep its markup.
        const hasEmbed = quill.root.querySelector("img, iframe") !== null;
        const html =
          quill.getText().trim() === "" && !hasEmbed
            ? ""
            : quill.root.innerHTML;
        onChangeRef.current(html);
      });
    })();

    return () => {
      cancelled = true;
      quillRef.current = null;
      container.innerHTML = "";
    };
    // Mount once: Quill owns its DOM after init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed when the parent bumps resetKey (e.g. a version was restored). Skips
  // the initial render — mount seeding already handled that.
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    const quill = quillRef.current;
    if (!quill) return;
    seedingRef.current = true;
    const html = valueRef.current;
    if (html) quill.clipboard.dangerouslyPasteHTML(html);
    else quill.setText("");
    seedingRef.current = false;
  }, [resetKey]);

  // Lock/unlock editing while an explicit save is in flight.
  useEffect(() => {
    quillRef.current?.enable(!disabled);
  }, [disabled]);

  return (
    // Give the editable area a taller default (min-height, so it still grows
    // with content). Targets Quill's `.ql-editor` via an arbitrary variant.
    // Embedded YouTube videos (`.ql-video`) span the full content width at a
    // fixed 16:9 ratio, so the author sees them exactly as the site renders.
    <div
      className={`[&_.ql-editor]:min-h-52 [&_.ql-video]:block [&_.ql-video]:w-full [&_.ql-video]:h-auto [&_.ql-video]:aspect-video [&_.ql-video]:pointer-events-none ${
        invalid ? "rounded-md ring-1 ring-danger" : ""
      } ${disabled ? "opacity-60" : ""}`}
    >
      <div ref={containerRef} />
      {uploading && (
        <p role="status" aria-live="polite" className="mt-1 text-sm text-muted">
          Uploading image…
        </p>
      )}
      {uploadError && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {uploadError}
        </p>
      )}
    </div>
  );
}
