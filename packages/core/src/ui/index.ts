// @cms-core/core/ui — barrel de componentes de UI genéricos do admin.
//
// S1.4: `AdminNav` (nav lateral genérica; label via prop `adminTitle`).
// S2.6: os 3 editores (`ContentEditor`/`RichTextEditor`/`MediaPicker`) + os
// primitivos (`Modal`/`Feedback`/`LoadingOverlay`/`styles`) foram MOVIDOS do
// subtree client-local `components/ui/*` para cá (revertendo o T4.7 [AUTO-DECISION]
// de S1.4). O acoplamento ao tema foi eliminado: os primitivos são genéricos (só
// classes Tailwind das CSS vars de branding que o `theme.generated.css` fornece
// no contexto do workspace). O `VersionHistory` FICA no cliente (depende das APIs
// de conteúdo do cliente) e é integrado ao `ContentEditor` via render-prop
// `renderVersionHistory` (S2.6 B2).

export { default as AdminNav, type NavItem } from "./AdminNav.js";

// Editores (S2.6)
export {
  default as ContentEditor,
  type VersionHistoryContext,
} from "./ContentEditor.js";
export { default as RichTextEditor } from "./RichTextEditor.js";
export { default as MediaPicker } from "./MediaPicker.js";

// Primitivos de UI (S2.6)
export { default as Modal } from "./Modal.js";
export { default as LoadingOverlay } from "./LoadingOverlay.js";
export {
  StatusBadge,
  StatusMessage,
  LiveRegion,
  Skeleton,
} from "./Feedback.js";

// Textos da UI do core (injetáveis pelo cliente; padrão em inglês).
export {
  CoreStringsProvider,
  useCoreStrings,
  DEFAULT_CORE_STRINGS,
  type CoreStrings,
} from "./strings.js";

// Tokens de estilo (S2.6)
export {
  input,
  textarea,
  select,
  buttonPrimary,
  buttonDark,
  buttonSecondary,
  buttonQuiet,
  buttonDanger,
} from "./styles.js";
