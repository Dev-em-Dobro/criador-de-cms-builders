"use client";

// @cms-core/core/ui — navegação lateral do admin (S1.4).
//
// Extraído de clients/demo-corp/components/AdminNav.tsx. Única mudança de
// lógica (§5 R4 do doc / ADR): o label "Demo Corp" hardcoded vira a prop
// `adminTitle`. O workspace passa `config.branding.adminTitle`. Nenhuma outra
// alteração de comportamento.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCoreStrings } from "./strings.js";

export interface NavItem {
  href: string;
  label: string;
}

export default function AdminNav({
  items,
  email,
  adminTitle,
}: {
  items: NavItem[];
  email: string;
  /** Rótulo de marca no topo da nav (era "Demo Corp" hardcoded). */
  adminTitle: string;
}) {
  const t = useCoreStrings();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close the drawer whenever navigation happens.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the drawer and returns focus to the toggle.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Lock background scroll while the mobile drawer is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the drawer when it opens on mobile.
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [open]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const activeItem = items.find((i) => isActive(i.href));

  return (
    <>
      {/* Mobile bar — the desktop sidebar is hidden below md. */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white px-4 py-2 md:hidden">
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="admin-nav"
          className="-ml-2 grid h-11 w-11 place-items-center rounded text-ink transition-colors duration-150 hover:bg-paper"
        >
          <span className="sr-only">{t.openMenu}</span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 4.5h14M2 9h14M2 13.5h14" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-ink">
          {activeItem?.label ?? "CMS"}
        </span>
      </header>

      {/* Backdrop, mobile only. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="admin-nav"
        ref={drawerRef}
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-paper p-5 transition-transform duration-200 md:static md:z-auto md:w-60 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-dark">
              {adminTitle}
            </p>
            <p className="text-sm font-semibold text-ink">CMS</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              toggleRef.current?.focus();
            }}
            className="-mr-2 -mt-2 grid h-11 w-11 place-items-center rounded text-muted transition-colors duration-150 hover:bg-white md:hidden"
          >
            <span className="sr-only">{t.closeMenu}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <form
          action="/api/auth/logout"
          method="post"
          className="mt-6 border-b border-line-strong pb-4"
        >
          <p className="mb-1 truncate text-xs text-muted" title={email}>
            {email}
          </p>
          <button
            type="submit"
            className="flex min-h-11 w-full items-center rounded px-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-white"
          >
            {t.signOut}
          </button>
        </form>

        <nav aria-label={t.sections} className="mt-6 flex flex-col gap-0.5">
          {items.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center rounded px-3 text-sm transition-colors duration-150 ${
                  active
                    ? "bg-white font-semibold text-ink shadow-sm"
                    : "text-ink hover:bg-white/70"
                }`}
              >
                {/* Active state is carried by weight + fill, not colour alone. */}
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
