/**
 * Lightweight i18n — no runtime deps. Flat dot keys, {var} interpolation.
 * Languages: English (en), Arabic (ar, RTL), French (fr), Spanish (es),
 * Portuguese-BR (pt), Filipino (fil).
 * Dictionaries live in sibling files: one flat Record<string,string> each.
 */

export type Lang = "en" | "ar" | "fr" | "es" | "pt" | "fil";

export const LANGS: { code: Lang; label: string; dir: "ltr" | "rtl"; flag: string }[] = [
  { code: "en", label: "English", dir: "ltr", flag: "🇬🇧" },
  { code: "ar", label: "العربية", dir: "rtl", flag: "🇸🇦" },
  { code: "fr", label: "Français", dir: "ltr", flag: "🇫🇷" },
  { code: "es", label: "Español", dir: "ltr", flag: "🇪🇸" },
  { code: "pt", label: "Português (BR)", dir: "ltr", flag: "🇧🇷" },
  { code: "fil", label: "Filipino", dir: "ltr", flag: "🇵🇭" },
];

export function isLang(v: string | null | undefined): v is Lang {
  return v === "en" || v === "ar" || v === "fr" || v === "es" || v === "pt" || v === "fil";
}

export function dirOf(lang: Lang): "ltr" | "rtl" {
  return lang === "ar" ? "rtl" : "ltr";
}

import { dict as en } from "./en";
import { dict as ar } from "./ar";
import { dict as fr } from "./fr";
import { dict as es } from "./es";
import { dict as pt } from "./pt";
import { dict as fil } from "./fil";

const DICTS: Record<Lang, Record<string, string>> = { en, ar, fr, es, pt, fil };

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const d = DICTS[lang] ?? en;
  let s = d[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Detect language from an Accept-Language header or a language code string. */
export function detectLang(acceptLanguage?: string | null): Lang {
  if (!acceptLanguage) return "en";
  const al = acceptLanguage.toLowerCase();
  if (al.startsWith("ar")) return "ar";
  if (al.startsWith("fr")) return "fr";
  if (al.startsWith("es")) return "es";
  if (al.startsWith("pt")) return "pt";
  if (al.startsWith("fil") || al.startsWith("tl") || al.startsWith("tgl")) return "fil";
  return "en";
}
