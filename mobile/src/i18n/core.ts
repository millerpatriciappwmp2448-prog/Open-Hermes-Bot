import { english } from './translations';

export type Language = 'zh' | 'en';
export type LanguagePreference = Language;
export type Params = Readonly<Record<string, string | number>>;

export function resolveLanguage(preference: LanguagePreference, systemLocale: string): Language {
  // Only 'zh' and 'en' allowed; fallback to 'en' for invalid/legacy values
  return preference === 'zh' ? 'zh' : 'en';
}

/** Interpolate once so user/server values are never recursively translated. */
export function translate(language: Language, key: string, params?: Params): string {
  const text = language === 'en' && Object.hasOwn(english, key) ? english[key] : key;
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match) : text;
}
