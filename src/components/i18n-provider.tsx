"use client";

/**
 * Lightweight i18n React layer on top of src/lib/i18n dictionaries.
 * Language persists in localStorage + <html lang/dir> are updated live.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LANGS, dirOf, isLang, t as translate, type Lang } from "@/lib/i18n";

interface I18nCtx {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx>({
  lang: "en",
  dir: "ltr",
  setLang: () => {},
  t: (k, v) => translate("en", k, v),
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // ALWAYS start with "en" to match the server-rendered HTML (the dictionary
  // is applied client-side). Reading localStorage in the state initializer
  // caused a hydration mismatch on every page for non-English visitors.
  // The stored/URL language is applied right after hydration instead.
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    let initial: Lang | null = null;
    try {
      // ?lang= URL override wins (shareable localized links / checkout).
      const param = new URLSearchParams(window.location.search).get("lang");
      if (param && isLang(param)) initial = param;
      if (!initial) {
        const stored = localStorage.getItem("librepay-lang") as Lang | null;
        if (stored && LANGS.some((l) => l.code === stored)) initial = stored;
      }
    } catch {}
    // Post-hydration locale restore is inherently a state update in an effect:
    // the server rendered "en", so the stored language can only be applied
    // on the client after mount (avoids hydration text mismatches).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial && initial !== "en") setLangState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("librepay-lang", l);
    } catch {}
  }, []);

  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      dir: dirOf(lang),
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
