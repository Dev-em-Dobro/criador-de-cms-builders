"use client";

import Link from "next/link";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StatusBadge, StatusMessage } from "@cms-core/core/ui";
import AddTranslationButton from "@/components/AddTranslationButton";
import RowActions from "@/components/admin/RowActions";

interface Variant {
  id: string;
  locale: string;
  status: string;
}
export interface PersonRow {
  translationGroupId: string;
  primaryId: string;
  title: string;
  updatedAt: string;
  variants: Variant[];
}
interface Locale {
  code: string;
  label: string;
}

function LanguageChips({
  row,
  active,
  collection,
}: {
  row: PersonRow;
  active: Locale[];
  collection: string;
}) {
  /**
   * Com um idioma só, os chips de idioma não têm função — não há para onde
   * trocar nem tradução a criar. Fica só o selo de situação (publicado /
   * rascunho), que é a informação útil da coluna. Volta ao normal assim que um
   * segundo idioma for ativado.
   */
  if (active.length <= 1) {
    const v = row.variants[0];
    return v ? <StatusBadge status={v.status} /> : null;
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {active.map((l) => {
        const v = row.variants.find((x) => x.locale === l.code);
        return v ? (
          <Link
            key={l.code}
            href={`/${collection}/${v.id}`}
            title={`${l.label} — ${v.status}`}
            className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink transition-colors duration-150 hover:border-brand-dark"
          >
            <span className="uppercase">{l.code}</span>
            <StatusBadge status={v.status} />
          </Link>
        ) : (
          <AddTranslationButton
            key={l.code}
            apiType={collection}
            id={row.primaryId}
            code={l.code}
            label={l.label}
            collection={collection}
          />
        );
      })}
    </span>
  );
}

function SortableRow({
  row,
  active,
  collection,
  onDeleted,
}: {
  row: PersonRow;
  active: Locale[];
  collection: string;
  onDeleted: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.translationGroupId });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-3 border-t border-line bg-white px-3 py-2 first:border-t-0 ${
        isDragging ? "relative z-10 shadow-md" : ""
      }`}
    >
      <button
        type="button"
        aria-label={`Reorder ${row.title}`}
        className="grid h-11 w-8 shrink-0 cursor-grab touch-none place-items-center rounded text-muted transition-colors duration-150 hover:bg-paper hover:text-ink active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="5" cy="3" r="1.4" fill="currentColor" />
          <circle cx="11" cy="3" r="1.4" fill="currentColor" />
          <circle cx="5" cy="8" r="1.4" fill="currentColor" />
          <circle cx="11" cy="8" r="1.4" fill="currentColor" />
          <circle cx="5" cy="13" r="1.4" fill="currentColor" />
          <circle cx="11" cy="13" r="1.4" fill="currentColor" />
        </svg>
      </button>

      <Link
        href={`/${collection}/${row.primaryId}`}
        className="min-w-[8rem] flex-1 font-medium text-ink underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:decoration-brand-dark"
      >
        {row.title}
      </Link>

      <LanguageChips row={row} active={active} collection={collection} />

      <time
        dateTime={row.updatedAt}
        className="w-24 shrink-0 text-sm text-muted"
      >
        {new Date(row.updatedAt).toLocaleDateString()}
      </time>

      <RowActions
        collection={collection}
        id={row.primaryId}
        title={row.title}
        onDeleted={onDeleted}
      />
    </li>
  );
}

/**
 * Drag-and-drop ordering for the people list. The order set here is persisted
 * and drives the order people appear in on the public site (FR: editorial
 * ordering). Optimistic: reorder locally, then POST; revert on failure.
 */
export default function PeopleReorderList({
  rows,
  active,
  collection,
}: {
  rows: PersonRow[];
  active: Locale[];
  collection: string;
}) {
  const [items, setItems] = useState(rows);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function persist(order: string[], previous: PersonRow[]) {
    setError("");
    try {
      const res = await fetch(`/api/admin/${collection}/reorder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order }),
      });
      if (!res.ok) {
        setItems(previous);
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "Could not save the new order.");
      }
    } catch {
      setItems(previous);
      setError("Could not save the new order — could not reach the server.");
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const from = items.findIndex((r) => r.translationGroupId === dragged.id);
    const to = items.findIndex((r) => r.translationGroupId === over.id);
    if (from === -1 || to === -1) return;
    const previous = items;
    const next = arrayMove(items, from, to);
    setItems(next);
    persist(
      next.map((r) => r.translationGroupId),
      previous,
    );
  }

  return (
    <div>
      {error && (
        <StatusMessage tone="error" className="mb-3">
          {error}
        </StatusMessage>
      )}
      <p className="mb-2 text-sm text-muted">
        Drag the handle to set the order people appear in on the site.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={items.map((r) => r.translationGroupId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="overflow-hidden rounded-lg border border-line-strong">
            {items.map((row) => (
              <SortableRow
                key={row.translationGroupId}
                row={row}
                active={active}
                collection={collection}
                onDeleted={() =>
                  setItems((cur) =>
                    cur.filter(
                      (r) => r.translationGroupId !== row.translationGroupId,
                    ),
                  )
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
