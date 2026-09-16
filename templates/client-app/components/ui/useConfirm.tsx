"use client";

import { useCallback, useRef, useState } from "react";
import { Modal } from "@cms-core/core/ui";

interface ConfirmOptions {
  title: string;
  description?: string;
  /** Label for the confirming action. Name the verb, not "OK". */
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
}

/**
 * Promise-based confirmation for irreversible actions.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ ... }))) return;
 *   ...
 *   return <>{confirmDialog}</>;
 *
 * Replaces window.confirm, which is unstyleable and blocks the event loop.
 */
export function useConfirm(): [
  (options: ConfirmOptions) => Promise<boolean>,
  React.ReactNode,
] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOptions(null);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const dialog = options ? (
    <Modal
      open
      size="sm"
      onClose={() => settle(false)}
      title={options.title}
      description={options.description}
    >
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => settle(false)}
          className="min-h-11 rounded border border-line-strong px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-paper"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => settle(true)}
          className={`min-h-11 rounded px-4 text-sm font-semibold text-white transition-colors duration-150 ${
            options.destructive
              ? "bg-danger hover:bg-brand-darker"
              : "bg-ink hover:bg-black"
          }`}
        >
          {options.confirmLabel}
        </button>
      </div>
    </Modal>
  ) : null;

  return [confirm, dialog];
}
