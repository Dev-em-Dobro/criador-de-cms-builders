"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldSpec } from "@cms-core/core/engine";
import {
  createAutosaveScheduler,
  shouldSave,
  type AutosaveScheduler,
} from "@cms-core/core/engine";
import MediaPicker from "./MediaPicker.js";
import RichTextEditor from "./RichTextEditor.js";
import LoadingOverlay from "./LoadingOverlay.js";
import { StatusBadge, StatusMessage } from "./Feedback.js";
import { useCoreStrings } from "./strings.js";
import {
  buttonDark,
  buttonPrimary,
  buttonSecondary,
  input,
  select,
  textarea,
} from "./styles.js";

/**
 * Contexto reativo passado ao render-prop `renderVersionHistory` (S2.6 B2). O
 * `VersionHistory` real vive no workspace do cliente (depende das APIs de
 * conteúdo do cliente); o `ContentEditor` (genérico, no core) só fornece o
 * estado reativo do editor. `open`/`onClose` derivam do estado interno
 * `versionsOpen` do editor; `id` nasce `null` e é populado após o 1º save
 * (`setId(body.id)`). Ver ADR de S2.6 / AC14.
 */
export interface VersionHistoryContext {
  apiType: string;
  id: string | null;
  currentVersionId: string | null;
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onRestore: (versionId: string) => void;
}

interface Initial {
  id?: string;
  data: Record<string, unknown>;
  currentVersionId?: string | null;
  status?: string;
  hasUnpublishedChanges?: boolean;
}

export default function ContentEditor({
  apiType,
  collection,
  mode,
  fields,
  initial,
  label,
  fixedSlug,
  availableLocales,
  defaultLocale,
  canPreview = true,
  renderVersionHistory,
}: {
  apiType: string;
  collection: string;
  mode: "collection" | "singleton";
  fields: FieldSpec[];
  initial: Initial;
  label: string;
  /** Force a slug on create (used by singleton pages: book, 5h, privacy...). */
  fixedSlug?: string;
  /** Active languages offered in the create-mode language picker. */
  availableLocales?: { code: string; label: string }[];
  defaultLocale?: string;
  /** Show the "Preview" button. Off for types with no public detail page. */
  canPreview?: boolean;
  /**
   * Render-prop do histórico de versões (S2.6 B2). O `VersionHistory` concreto
   * vive no cliente (depende das APIs de conteúdo do cliente); o editor genérico
   * só passa o contexto reativo. Chamado somente quando `id` existe (após 1º
   * save). Se ausente, o histórico não é renderizado.
   */
  renderVersionHistory?: (ctx: VersionHistoryContext) => React.ReactNode;
}) {
  const t = useCoreStrings();
  const router = useRouter();
  const formId = useId();
  const [data, setData] = useState<Record<string, unknown>>(initial.data);
  const [id, setId] = useState(initial.id);
  const [versionId, setVersionId] = useState(initial.currentVersionId ?? null);
  const [status, setStatus] = useState(initial.status ?? "draft");
  const [hasUnpublished, setHasUnpublished] = useState(
    initial.hasUnpublishedChanges ?? false,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Fields are locked during explicit saves (manual save, publish, restore) —
  // but NOT during background auto-save, so typing is never interrupted.
  const [locked, setLocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Language chosen for a brand-new entry (create mode only).
  const [locale, setLocale] = useState(defaultLocale ?? "en");
  // Remount seed: bumped after a restore so uncontrolled editors (Quill)
  // re-initialise with the restored content.
  const [revision, setRevision] = useState(0);
  // True while ANY write (manual save, auto-save, restore) is in flight — the
  // single guard that keeps those paths from overlapping.
  const savingRef = useRef(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  // Auto-save: a debounced scheduler saves the draft ~10s after the last edit
  // and on blur. `tryAutosaveRef` always holds the latest decision so the
  // scheduler (created once) reads current state without being recreated.
  const tryAutosaveRef = useRef<() => void>(() => {});
  const autosaveRef = useRef<AutosaveScheduler | null>(null);
  if (!autosaveRef.current) {
    autosaveRef.current = createAutosaveScheduler(() => tryAutosaveRef.current());
  }

  // Raw JSON text for `json` fields (parsed on save).
  const [jsonText, setJsonText] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const f of fields)
      if (f.kind === "json")
        m[f.name] = JSON.stringify(initial.data[f.name] ?? null, null, 2);
    return m;
  });

  // Warn before losing unsaved edits on reload/close. In-app navigation is
  // guarded separately by the browser only for full loads, so keep edits
  // visible by never clearing state on failure.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Send focus to the error summary so keyboard users land on the problem.
  useEffect(() => {
    if (Object.keys(errors).length > 0) errorSummaryRef.current?.focus();
  }, [errors]);

  // Keep the auto-save decision current on every render (reads latest state).
  useEffect(() => {
    tryAutosaveRef.current = () => {
      if (
        shouldSave({
          dirty,
          hasId: Boolean(id),
          inFlight: savingRef.current,
          payloadValid: jsonFieldsValid(),
        })
      ) {
        void saveDraft({ silent: true });
      }
    };
  });

  // Cancel any pending auto-save when the editor unmounts.
  useEffect(() => {
    return () => autosaveRef.current?.cancel();
  }, []);

  function set(name: string, value: unknown) {
    setDirty(true);
    setData((d) => ({ ...d, [name]: value }));
    autosaveRef.current?.schedule();
  }

  /** True if all `json` fields currently parse — a non-mutating validity check. */
  function jsonFieldsValid(): boolean {
    for (const f of fields) {
      if (f.kind === "json") {
        try {
          JSON.parse(jsonText[f.name] || "null");
        } catch {
          return false;
        }
      }
    }
    return true;
  }

  function buildPayload(): Record<string, unknown> | null {
    const payload = { ...data };
    for (const f of fields) {
      if (f.kind === "json") {
        try {
          payload[f.name] = JSON.parse(jsonText[f.name] || "null");
        } catch {
          setErrors({ [f.name]: t.invalidJson });
          return null;
        }
      }
    }
    return payload;
  }

  /**
   * Save the current draft. Shared by the manual button, auto-save, and the
   * restore flow. Returns the outcome so callers (restore) can chain safely.
   * Guards against overlapping writes via `savingRef`.
   */
  async function saveDraft(
    opts: { silent?: boolean } = {},
  ): Promise<{ ok: boolean; conflict?: boolean }> {
    if (savingRef.current) return { ok: false };
    autosaveRef.current?.cancel(); // no queued auto-save should double-fire
    setMessage(null);
    setErrors({});
    const payload = buildPayload();
    if (!payload) return { ok: false };

    savingRef.current = true;
    setBusy(true);
    // Background (auto-save) and restore's pre-save leave the lock to the caller.
    if (!opts.silent) setLocked(true);
    try {
      const res = id
        ? await fetch(`/api/admin/${apiType}/${id}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data: payload, expectedVersionId: versionId }),
          })
        : await fetch(`/api/admin/${apiType}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              data: payload,
              locale,
              ...(fixedSlug ? { slug: fixedSlug } : {}),
            }),
          });
      const body = await res.json();

      if (res.status === 422) {
        setErrors(body.fields ?? { _: body.error ?? t.validationFailed });
        return { ok: false };
      }
      if (res.status === 409) {
        setMessage({
          tone: "error",
          text:
            body.error ?? t.saveConflict,
        });
        return { ok: false, conflict: true };
      }
      if (!res.ok) {
        setMessage({ tone: "error", text: body.error ?? t.saveFailed });
        return { ok: false };
      }

      setId(body.id);
      setVersionId(body.currentVersionId ?? null);
      setStatus(body.status ?? "draft");
      setHasUnpublished(body.hasUnpublishedChanges ?? false);
      setDirty(false);
      setMessage({ tone: "success", text: t.draftSaved });
      if (!id && mode === "collection") {
        router.replace(`/${collection}/${body.id}`);
      }
      return { ok: true };
    } catch {
      setMessage({
        tone: "error",
        text: t.offlineSaveRetry,
      });
      return { ok: false };
    } finally {
      savingRef.current = false;
      setBusy(false);
      if (!opts.silent) setLocked(false);
    }
  }

  /**
   * Restore a previous version. If there are unsaved on-screen changes, save
   * them as a draft first so nothing is lost, then apply the restore.
   */
  async function restoreVersion(restoreId: string) {
    if (!id || savingRef.current) return;
    autosaveRef.current?.cancel();
    setLocked(true); // stays locked across the pre-save and the restore
    if (dirty) {
      const r = await saveDraft({ silent: true });
      if (!r.ok) {
        setLocked(false);
        return; // error already surfaced; keep on-screen work
      }
    }

    savingRef.current = true;
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      const res = await fetch(`/api/admin/${apiType}/${id}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: restoreId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage({ tone: "error", text: body.error ?? t.restoreFailed });
        return;
      }

      const restored = (body.data ?? {}) as Record<string, unknown>;
      setData(restored);
      // Re-seed the raw JSON editors from the restored data.
      setJsonText(() => {
        const m: Record<string, string> = {};
        for (const f of fields)
          if (f.kind === "json")
            m[f.name] = JSON.stringify(restored[f.name] ?? null, null, 2);
        return m;
      });
      setVersionId(body.currentVersionId ?? null);
      setStatus(body.status ?? status);
      setDirty(false);
      setRevision((n) => n + 1); // remount editors with restored content
      setMessage({ tone: "success", text: t.versionRestored });
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Retry." });
    } finally {
      savingRef.current = false;
      setBusy(false);
      setLocked(false);
    }
  }

  async function doAction(action: "publish" | "unpublish") {
    // Verbo já traduzido para as mensagens de falha ("Can't publish…").
    const verb = action === "publish" ? t.publishVerb : t.unpublishVerb;
    if (!id || savingRef.current) return;
    autosaveRef.current?.cancel();
    setLocked(true);
    // Publish validates the persisted entry, so flush unsaved edits first —
    // otherwise a just-picked image or edited field wouldn't be seen by the
    // publish gate (e.g. a new cover would still look "not found").
    if (action === "publish" && dirty) {
      const r = await saveDraft({ silent: true });
      if (!r.ok) {
        setLocked(false);
        return; // save error already surfaced; keep on-screen work
      }
    }

    savingRef.current = true;
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      const res = await fetch(`/api/admin/${apiType}/${id}/${action}`, {
        method: "POST",
      });
      const body = await res.json();
      if (res.status === 422) {
        // Publish gate failed (missing required fields and/or a deleted media
        // reference). Map each raw error to its field so the summary highlights
        // it and the message lists the offending fields by name.
        const raw = (body.fields ?? {}) as Record<string, string>;
        const mapped: Record<string, string> = {};
        const labels: string[] = [];
        for (const [key, msg] of Object.entries(raw)) {
          // Direct match = a missing/invalid field. Otherwise it's a media
          // reference error keyed by the media id, not the field name.
          let field = fields.find((f) => f.name === key);
          let text = t.fieldRequired;
          if (!field) {
            field = fields.find((f) => f.kind === "media" && data[f.name] === key);
            if (field) text = t.mediaDeleted;
          }
          if (field) {
            mapped[field.name] = text;
            labels.push(field.label);
          } else {
            mapped._ = msg;
            labels.push(msg);
          }
        }
        setErrors(Object.keys(mapped).length ? mapped : raw);
        setMessage({
          tone: "error",
          text: labels.length
            ? t.cantActionFix(verb, labels.join(", "))
            : t.cantActionReason(verb, body.error ?? t.validationFailed),
        });
        return;
      }
      if (!res.ok)
        return setMessage({ tone: "error", text: body.error ?? t.actionFailed });
      setStatus(body.status);
      setHasUnpublished(body.hasUnpublishedChanges ?? false);
      setMessage({
        tone: "success",
        text: action === "publish" ? t.published : t.unpublished,
      });
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Retry." });
    } finally {
      savingRef.current = false;
      setBusy(false);
      setLocked(false);
    }
  }

  async function preview() {
    if (!id) return;
    // Open synchronously inside the click gesture, then redirect. Calling
    // window.open() after an await gets blocked as an unsolicited popup.
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`/api/admin/${apiType}/${id}/preview`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("preview failed");
      const { url } = await res.json();
      if (tab) tab.location.href = url;
      else setMessage({ tone: "error", text: t.allowPopups });
    } catch {
      tab?.close();
      setMessage({ tone: "error", text: t.previewFailed });
    }
  }

  const fieldErrors = fields.filter((f) => errors[f.name]);

  return (
    <div className="max-w-2xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{label}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusBadge status={status} />
            {dirty && (
              <span className="text-xs text-muted">{t.unsavedChanges}</span>
            )}
          </div>
        </div>
        {id && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVersionsOpen(true)}
              className={buttonSecondary}
            >
              {t.versionHistory}
            </button>
            {canPreview && (
              <button type="button" onClick={preview} className={buttonSecondary}>
                {t.preview}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Create-mode language picker: choose the new entry's language.
       *
       * Só aparece com DUAS ou mais opções. Num cliente monolíngue
       * (`locales.enabled` com uma entrada só) o select tinha uma opção única e
       * pré-selecionada — não oferecia decisão nenhuma, só pedia atenção do
       * editor em toda criação de conteúdo. Com `length > 1` ele some sozinho
       * onde não faz sentido e continua igual onde faz: o `locale` enviado é o
       * mesmo `defaultLocale` que o select já vinha mostrando. Mesmo raciocínio
       * que tirou "Idiomas" da navegação desse cliente. */}
      {!id && availableLocales && availableLocales.length > 1 && (
        <div className="mb-5 flex items-center gap-2">
          <label
            htmlFor={`${formId}-locale`}
            className="text-sm font-medium text-ink"
          >
            {t.language}
          </label>
          <select
            id={`${formId}-locale`}
            className={select}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            {availableLocales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Error summary: announced, focusable, and links to each bad field. */}
      {(fieldErrors.length > 0 || errors._) && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          className="mb-5 rounded border border-danger bg-danger-surface p-3 outline-none"
        >
          <p className="text-sm font-semibold text-danger">
            {errors._ ?? t.fixBeforeSaving}
          </p>
          {fieldErrors.length > 0 && (
            <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-5 text-sm text-danger">
              {fieldErrors.map((f) => (
                <li key={f.name}>
                  <a href={`#${formId}-${f.name}`} className="underline">
                    {f.label}
                  </a>
                  : {errors[f.name]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Blur anywhere in the form flushes a pending auto-save immediately.
          onBlur bubbles (focusout), so it also covers the Quill editors. */}
      <div
        className="flex flex-col gap-5"
        onBlur={() => autosaveRef.current?.flush()}
      >
        {fields.map((f) => {
          const fieldId = `${formId}-${f.name}`;
          const helpId = f.help ? `${fieldId}-help` : undefined;
          const errorId = errors[f.name] ? `${fieldId}-error` : undefined;
          const describedBy =
            [helpId, errorId].filter(Boolean).join(" ") || undefined;

          // `facets`, `media` and `richtext` render controls that aren't a
          // single native input, so they get a group label rather than a
          // <label for> pointing at one input.
          const isGroup =
            f.kind === "facets" || f.kind === "media" || f.kind === "richtext";

          return (
            <div key={f.name} className="flex flex-col gap-1.5">
              {isGroup ? (
                <span id={`${fieldId}-label`} className="text-sm font-medium text-ink">
                  {f.label}
                  {f.required && (
                    <span className="text-danger" aria-hidden="true">
                      {" "}
                      *
                    </span>
                  )}
                  {f.required && <span className="sr-only"> (required)</span>}
                </span>
              ) : (
                <label htmlFor={fieldId} className="text-sm font-medium text-ink">
                  {f.label}
                  {f.required && (
                    <span className="text-danger" aria-hidden="true">
                      {" "}
                      *
                    </span>
                  )}
                  {f.required && <span className="sr-only"> (required)</span>}
                </label>
              )}

              {f.help && (
                <p id={helpId} className="text-xs text-muted">
                  {f.help}
                </p>
              )}

              {renderField(f, fieldId, describedBy)}

              {errors[f.name] && (
                <p id={errorId} className="text-xs font-medium text-danger">
                  {errors[f.name]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions stay reachable on long forms without hiding page content. */}
      <div className="sticky bottom-0 mt-8 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 py-4 backdrop-blur">
        {/* Status badge (published only). */}
        {id && status === "published" && !hasUnpublished && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            {t.liveBadge}
          </span>
        )}
        {id && status === "published" && hasUnpublished && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            {t.unpublishedChangesBadge}
          </span>
        )}

        <button
          type="button"
          onClick={() => saveDraft()}
          disabled={busy}
          aria-busy={busy}
          className={buttonDark}
        >
          {busy ? t.saving : t.saveDraft}
        </button>

        {/* Never-published draft: Publish is the primary action. */}
        {id && status !== "published" && (
          <button
            type="button"
            onClick={() => doAction("publish")}
            disabled={busy}
            aria-busy={busy}
            className={buttonPrimary}
          >
            {t.publish}
          </button>
        )}

        {/* Published WITH pending edits: promote the staged changes. */}
        {id && status === "published" && hasUnpublished && (
          <button
            type="button"
            onClick={() => doAction("publish")}
            disabled={busy}
            aria-busy={busy}
            className={buttonPrimary}
          >
            {t.publishChanges}
          </button>
        )}

        {/* Published: allow taking it offline. */}
        {id && status === "published" && (
          <button
            type="button"
            onClick={() => doAction("unpublish")}
            disabled={busy}
            aria-busy={busy}
            className={buttonSecondary}
          >
            {t.unpublish}
          </button>
        )}

        {message && (
          <StatusMessage tone={message.tone}>{message.text}</StatusMessage>
        )}
      </div>

      {/* Explain what "unpublished changes" means, right under the actions. */}
      {id && status === "published" && hasUnpublished && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.unpublishedHint}
        </p>
      )}

      {/* VersionHistory via render-prop (S2.6 B2): o componente concreto vive no
          cliente; o editor genérico passa o contexto reativo. Só renderiza quando
          `id` existe (após 1º save), preservando o guard `id &&` original. */}
      {id &&
        renderVersionHistory?.({
          apiType,
          id,
          currentVersionId: versionId,
          busy,
          open: versionsOpen,
          onClose: () => setVersionsOpen(false),
          onRestore: async (vid: string) => {
            await restoreVersion(vid);
            setVersionsOpen(false);
          },
        })}

      {/* Lock the whole screen during an explicit save/publish/restore.
          Auto-save is deliberately excluded (it must never interrupt typing). */}
      <LoadingOverlay show={locked} message={t.saving} />
    </div>
  );

  function renderField(f: FieldSpec, fieldId: string, describedBy?: string) {
    const val = data[f.name];
    const invalid = Boolean(errors[f.name]);
    const a11y = {
      id: fieldId,
      "aria-describedby": describedBy,
      "aria-invalid": invalid || undefined,
      "aria-required": f.required || undefined,
      disabled: locked,
    };
    const ring = invalid ? "border-danger" : "";

    switch (f.kind) {
      case "textarea":
        return (
          <textarea
            {...a11y}
            className={`${textarea} ${ring}`}
            rows={3}
            value={String(val ?? "")}
            onChange={(e) => set(f.name, e.target.value)}
          />
        );
      case "richtext":
        return (
          <RichTextEditor
            value={String(val ?? "")}
            onChange={(html) => set(f.name, html)}
            labelledBy={`${fieldId}-label`}
            describedBy={describedBy}
            invalid={invalid}
            resetKey={revision}
            disabled={locked}
          />
        );
      case "media":
        return (
          <MediaPicker
            labelledBy={`${fieldId}-label`}
            describedBy={describedBy}
            value={typeof val === "string" && val ? val : undefined}
            onChange={(mediaId) => set(f.name, mediaId ?? "")}
            uploadField={f.uploadField}
            disabled={locked}
          />
        );
      case "stringList":
        return (
          <StringListInput
            a11y={a11y}
            className={`${textarea} ${ring}`}
            value={Array.isArray(val) ? (val as string[]) : []}
            onChange={(next) => set(f.name, next)}
            resetKey={revision}
          />
        );
      case "facets":
        return (
          <FacetsInput
            fieldId={fieldId}
            labelledBy={`${fieldId}-label`}
            value={val}
            onChange={(v) => set(f.name, v)}
            disabled={locked}
          />
        );
      case "json":
        return (
          <textarea
            {...a11y}
            className={`${textarea} ${ring} font-mono`}
            rows={5}
            spellCheck={false}
            value={jsonText[f.name] ?? ""}
            onChange={(e) => {
              setDirty(true);
              setJsonText((m) => ({ ...m, [f.name]: e.target.value }));
            }}
          />
        );
      default:
        return (
          <input
            {...a11y}
            className={`${input} ${ring}`}
            type={
              f.kind === "url"
                ? "url"
                : f.kind === "email"
                  ? "email"
                  : f.kind === "date"
                    ? "date"
                    : "text"
            }
            value={String(val ?? "")}
            onChange={(e) => set(f.name, e.target.value)}
          />
        );
    }
  }
}

/**
 * A "one per line" list editor.
 *
 * The stored value is a clean `string[]` (trimmed, no blank entries), but the
 * textarea is driven by its own raw-text state so typing behaves normally.
 * Normalising on every keystroke and feeding the cleaned array back as the
 * textarea value made spaces and line breaks impossible to type — a trailing
 * space was trimmed away and a fresh blank line was filtered out the instant it
 * was pressed. Local text preserves what you type; the parsed array is what we
 * persist. It re-syncs from the source of truth only when `resetKey` changes
 * (initial load / version restore), never on our own edits.
 */
function StringListInput({
  a11y,
  className,
  value,
  onChange,
  resetKey,
}: {
  a11y: React.ComponentPropsWithoutRef<"textarea">;
  className: string;
  value: string[];
  onChange: (v: string[]) => void;
  resetKey: number;
}) {
  const t = useCoreStrings();
  const [text, setText] = useState(() => value.join("\n"));

  // Re-seed the text from the source of truth only when `resetKey` changes
  // (initial load / version restore) — never on our own keystrokes, so a
  // trailing space or a fresh blank line survives long enough to type. This is
  // React's "adjust state during render" pattern; it avoids an effect (and the
  // extra render it would cost) by reacting to the key change inline.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setText(value.join("\n"));
  }

  return (
    <textarea
      {...a11y}
      className={className}
      rows={2}
      placeholder={t.onePerLine}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
      }}
    />
  );
}

// KNOWN-DEBT (S2.6 B3): estas keys espelham `client.config.ts` (facets do `case`
// do Demo Corp). Ao mover o ContentEditor para o core genérico, este literal
// de cliente entra no pacote. NÃO parametrizado nesta story (fora do escopo de
// S2.6) para não estufá-la — mantido como known-debt consciente.
// TODO: parametrizar via prop `facetKeys?: string[]` (default = este array) com
// as keys vindas do config — follow-up dedicado fora de S2.6.
const FACET_KEYS = ["industry", "service", "region", "outcome"] as const;

function FacetsInput({
  fieldId,
  labelledBy,
  value,
  onChange,
  disabled,
}: {
  fieldId: string;
  labelledBy: string;
  value: unknown;
  onChange: (v: Record<string, string[]>) => void;
  disabled?: boolean;
}) {
  const t = useCoreStrings();
  const facets = (value as Record<string, string[]>) ?? {
    industry: [],
    service: [],
    region: [],
    outcome: [],
  };
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid gap-3 sm:grid-cols-2"
    >
      {FACET_KEYS.map((k) => {
        const id = `${fieldId}-${k}`;
        return (
          <div key={k} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs font-medium capitalize text-muted">
              {k}
            </label>
            <input
              id={id}
              className={input}
              placeholder={t.commaSeparated}
              disabled={disabled}
              value={(facets[k] ?? []).join(", ")}
              onChange={(e) =>
                onChange({
                  ...facets,
                  [k]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}
