"use client";

/**
 * Language switcher — flag trigger + responsive dropdown.
 * Flags are self-hosted SVGs (/flags/<code>.svg, from flagcdn) so they render
 * identically on every OS (Windows does not render flag emojis).
 * Works with mouse, touch and keyboard (Escape / click-outside close),
 * and respects RTL via logical (start/end) positioning.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS, type Lang } from "@/lib/i18n";
import { useI18n } from "@/components/i18n-provider";

export function LangFlag({ code, className }: { code: Lang; className?: string }) {
  return (
    <img
      src={`/flags/${code}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("h-3.5 w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-black/10", className)}
    />
  );
}

export function LanguageDropdown({
  lang: langProp,
  onLangChange,
  align = "end",
  block = false,
  className,
}: {
  /** Controlled mode (e.g. checkout page with its own lang state). */
  lang?: Lang;
  onLangChange?: (l: Lang) => void;
  align?: "start" | "end";
  /** Stretch trigger to full container width (sidebar / mobile menus). */
  block?: boolean;
  className?: string;
}) {
  const ctx = useI18n();
  const lang = langProp ?? ctx.lang;
  const setLang = onLangChange ?? ctx.setLang;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  return (
    <div ref={rootRef} className={cn("relative", block && "w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Change language"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground",
          block && "w-full justify-between"
        )}
      >
        <span className="inline-flex items-center gap-2">
          <LangFlag code={current.code} className="h-4 w-6" />
          <span className={cn(block ? "inline" : "hidden min-[420px]:inline")}>{current.label}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 opacity-70 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Languages"
          className={cn(
            "absolute top-[calc(100%+6px)] z-[60] min-w-[200px] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl shadow-black/30",
            align === "end" ? "end-0" : "start-0"
          )}
        >
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === l.code}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2.5 text-sm transition-colors",
                lang === l.code ? "bg-primary/15 text-primary" : "text-foreground/90 hover:bg-muted"
              )}
            >
              <LangFlag code={l.code} className="h-4 w-6" />
              <span className="flex-1 text-start font-medium">{l.label}</span>
              {lang === l.code && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
