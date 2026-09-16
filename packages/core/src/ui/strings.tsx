"use client";

/**
 * Textos da UI do core, injetáveis pelo workspace-cliente.
 *
 * Por que existe: os componentes genéricos (editor de conteúdo, seletor de
 * mídia, diálogos) traziam o texto em inglês embutido. Num CMS pt-BR isso
 * aparecia no meio de telas traduzidas — e traduzir os literais aqui dentro
 * tornaria a FÁBRICA inteira português-only, o que é pior: o core é
 * compartilhado por todos os clientes.
 *
 * O contrato: o core segue com o inglês como PADRÃO (`DEFAULT_CORE_STRINGS`,
 * byte-idêntico aos literais anteriores) e o cliente que quiser outro idioma
 * envolve o admin com `CoreStringsProvider`, passando seu dicionário. Nenhum
 * idioma além do inglês vive neste pacote.
 *
 * Todas as chaves são obrigatórias em `CoreStrings`: um dicionário incompleto
 * quebra o typecheck do cliente, então "traduzido pela metade" não compila.
 *
 * Interpolação usa função (`cantAction`, `uploadedFile`) em vez de placeholders
 * em string, para o compilador cobrar os argumentos. Como funções não cruzam a
 * fronteira Server→Client do Next, monte o dicionário dentro de um módulo
 * `"use client"` (ver `CoreStringsProvider`).
 */

import { createContext, useContext } from "react";

export interface CoreStrings {
  // --- editor de conteúdo -------------------------------------------------
  invalidJson: string;
  validationFailed: string;
  saveConflict: string;
  saveFailed: string;
  draftSaved: string;
  offlineSaveRetry: string;
  restoreFailed: string;
  versionRestored: string;
  offlineRetry: string;
  fieldRequired: string;
  mediaDeleted: string;
  actionFailed: string;
  published: string;
  unpublished: string;
  allowPopups: string;
  previewFailed: string;
  unsavedChanges: string;
  versionHistory: string;
  preview: string;
  language: string;
  fixBeforeSaving: string;
  requiredSuffix: string;
  liveBadge: string;
  unpublishedChangesBadge: string;
  saving: string;
  saveDraft: string;
  publish: string;
  publishChanges: string;
  unpublish: string;
  unpublishedHint: string;
  onePerLine: string;
  commaSeparated: string;
  /** Verbos usados nas mensagens de falha de publicação. */
  publishVerb: string;
  unpublishVerb: string;
  /** "Can't {verb}. Please fix: {fields}." */
  cantActionFix: (verb: string, fields: string) => string;
  /** "Can't {verb}: {reason}" */
  cantActionReason: (verb: string, reason: string) => string;

  // --- seletor de mídia ---------------------------------------------------
  mediaLoadFailed: string;
  uploadFailed: string;
  uploadFailedOffline: string;
  selectedMedia: string;
  noMediaSelected: string;
  change: string;
  chooseMedia: string;
  mediaLibrary: string;
  mediaLibraryHint: string;
  uploading: string;
  upload: string;
  noMediaYet: string;

  // --- editor de texto rico ----------------------------------------------
  imageUploadFailed: string;
  pasteYoutubeUrl: string;
  invalidYoutubeUrl: string;
  removeEmbed: string;

  // --- diálogo / carregamento --------------------------------------------
  closeDialog: string;
  loading: string;

  // --- navegação ----------------------------------------------------------
  openMenu: string;
  closeMenu: string;
  sections: string;
  signOut: string;

  /** Rótulos dos selos de situação (chave = valor cru vindo da API). */
  statusLabels: Record<string, string>;
}

/** Inglês — o que os componentes traziam embutido antes desta extração. */
export const DEFAULT_CORE_STRINGS: CoreStrings = {
  invalidJson: "Invalid JSON — check for a trailing comma or unquoted key.",
  validationFailed: "Validation failed",
  saveConflict:
    "Someone else saved this entry while you were editing. Reload to get their changes.",
  saveFailed: "Save failed",
  draftSaved: "Draft saved.",
  offlineSaveRetry: "Could not reach the server. Your edits are still here — retry.",
  restoreFailed: "Restore failed",
  versionRestored: "Version restored.",
  offlineRetry: "Could not reach the server. Retry.",
  fieldRequired: "This field is required.",
  mediaDeleted: "The selected file was deleted — pick another.",
  actionFailed: "Action failed",
  published: "Published.",
  unpublished: "Unpublished.",
  allowPopups: "Allow popups to open the preview.",
  previewFailed: "Could not open preview.",
  unsavedChanges: "Unsaved changes",
  versionHistory: "Version history",
  preview: "Preview",
  language: "Language",
  fixBeforeSaving: "Fix the following before saving:",
  requiredSuffix: " (required)",
  liveBadge: "● Live",
  unpublishedChangesBadge: "⚠ Unpublished changes",
  saving: "Saving…",
  saveDraft: "Save draft",
  publish: "Publish",
  publishChanges: "Publish changes",
  unpublish: "Unpublish",
  unpublishedHint:
    "You have unpublished changes — the site still shows the last published version. Click “Publish changes” to make them live.",
  onePerLine: "One per line",
  commaSeparated: "comma, separated",
  publishVerb: "publish",
  unpublishVerb: "unpublish",
  cantActionFix: (verb, fields) => `Can't ${verb}. Please fix: ${fields}.`,
  cantActionReason: (verb, reason) => `Can't ${verb}: ${reason}`,

  mediaLoadFailed: "Could not load the media library.",
  uploadFailed: "Upload failed.",
  uploadFailedOffline: "Upload failed — could not reach the server.",
  selectedMedia: "Selected media",
  noMediaSelected: "No media selected",
  change: "Change",
  chooseMedia: "Choose media",
  mediaLibrary: "Media library",
  mediaLibraryHint: "Pick an existing asset or upload a new one.",
  uploading: "Uploading…",
  upload: "Upload",
  noMediaYet: "No media yet — upload your first asset.",

  imageUploadFailed: "Image upload failed",
  pasteYoutubeUrl: "Paste a YouTube video URL",
  invalidYoutubeUrl: "Invalid or non-YouTube video URL",
  removeEmbed: "Remove embed",

  closeDialog: "Close dialog",
  loading: "Loading…",

  openMenu: "Open navigation menu",
  closeMenu: "Close navigation menu",
  sections: "Sections",
  signOut: "Sign out",

  statusLabels: {
    published: "published",
    draft: "draft",
    active: "active",
    disabled: "disabled",
    invited: "invited",
  },
};

const CoreStringsContext = createContext<CoreStrings>(DEFAULT_CORE_STRINGS);

/**
 * Fornece o dicionário aos componentes do core. Monte-o num módulo
 * `"use client"` do cliente e envolva o layout do admin — funções não podem
 * cruzar a fronteira Server→Client, então o objeto tem de nascer no lado
 * cliente.
 */
export function CoreStringsProvider({
  value,
  children,
}: {
  value: CoreStrings;
  children: React.ReactNode;
}) {
  return (
    <CoreStringsContext.Provider value={value}>
      {children}
    </CoreStringsContext.Provider>
  );
}

/** Textos vigentes. Sem Provider, devolve o inglês padrão. */
export function useCoreStrings(): CoreStrings {
  return useContext(CoreStringsContext);
}
