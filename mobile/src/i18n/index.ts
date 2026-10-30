import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { resolveLanguage, translate, type Language, type LanguagePreference, type Params } from './core';

export type { LanguagePreference } from './core';
const STORAGE_KEY = 'hermes.interface.language';
const listeners = new Set<() => void>();
let preference: LanguagePreference = 'system';
let revision = 0;
let saving: Promise<void> = Promise.resolve();
let saveError = false;

function systemLocale(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; }
  catch { return 'en'; }
}

let language = resolveLanguage(preference, systemLocale());
let snapshot: { language: Language; preference: LanguagePreference; saveError: boolean } = { language, preference, saveError };
function publish() {
  language = resolveLanguage(preference, systemLocale());
  snapshot = { language, preference, saveError };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getSnapshot = () => snapshot;

/** Also used by async bridge callbacks, in the currently selected language. */
export function t(key: string, params?: Params): string {
  return translate(language, key, params);
}

export function localeTag(): string { return language === 'zh' ? 'zh-CN' : 'en-US'; }

function setPreference(next: LanguagePreference) {
  preference = next;
  revision += 1;
  saveError = false;
  publish();
  // Web previews intentionally keep preferences in memory, with no localStorage.
  if (Platform.OS === 'web') return;
  const writeRevision = revision;
  saving = saving.then(async () => {
    try { await SecureStore.setItemAsync(STORAGE_KEY, next); }
    catch {
      if (revision === writeRevision) { saveError = true; publish(); }
    }
  });
}

export function useTranslation() {
  return { ...useSyncExternalStore(subscribe, getSnapshot, getSnapshot), t, setPreference };
}

/** Called at the app root; changing language never remounts conversations. */
export function useInitializeLanguage() {
  useEffect(() => {
    let active = true;
    const initialRevision = revision;
    if (Platform.OS !== 'web') {
      void SecureStore.getItemAsync(STORAGE_KEY).then((saved) => {
        if (!active || revision !== initialRevision) return;
        if (saved === 'zh' || saved === 'en' || saved === 'system') {
          preference = saved;
          publish();
        }
      }).catch(() => undefined);
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && preference === 'system') publish();
    });
    return () => { active = false; subscription.remove(); };
  }, []);
}
