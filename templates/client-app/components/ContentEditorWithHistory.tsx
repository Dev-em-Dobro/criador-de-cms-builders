"use client";

// clients/demo-corp/components/ContentEditorWithHistory.tsx
//
// Wrapper CLIENT (S2.6 B2) do `ContentEditor` genérico do core. Existe para
// resolver a fronteira Server/Client do Next.js: os 3 call-sites do editor são
// Server Components (async) e NÃO podem passar uma função (`renderVersionHistory`)
// para um Client Component. Este wrapper é `"use client"`, então a render-prop é
// composta DO LADO cliente da fronteira. O `VersionHistory` (que depende das APIs
// de conteúdo do cliente) fica no workspace e é injetado aqui.
//
// Os call-sites usam este wrapper com as MESMAS props do `ContentEditor`; o
// histórico de versões + restore continuam idênticos ao comportamento anterior.

import { ComponentProps } from "react";
import { ContentEditor } from "@cms-core/core/ui";
import VersionHistory from "./VersionHistory";

type ContentEditorProps = ComponentProps<typeof ContentEditor>;

// Aceita todas as props do ContentEditor EXCETO a render-prop (que este wrapper
// fornece internamente).
type Props = Omit<ContentEditorProps, "renderVersionHistory">;

export default function ContentEditorWithHistory(props: Props) {
  return (
    <ContentEditor
      {...props}
      renderVersionHistory={(ctx) => (
        <VersionHistory
          open={ctx.open}
          onClose={ctx.onClose}
          apiType={ctx.apiType}
          // `renderVersionHistory` só é chamado quando `id` existe (guard no core);
          // aqui `ctx.id` é garantidamente string.
          id={ctx.id as string}
          currentVersionId={ctx.currentVersionId}
          busy={ctx.busy}
          onRestore={ctx.onRestore}
        />
      )}
    />
  );
}
