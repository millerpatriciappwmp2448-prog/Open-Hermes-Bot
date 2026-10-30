import { useEffect, useSyncExternalStore } from 'react';
import { Appearance, AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createAppearanceStore, type ColorScheme } from './appearanceStore';

export type { AppearancePreference, ColorScheme, ThemeName } from './appearanceStore';
const STORAGE_KEY = 'hermes.interface.appearance';
const systemScheme = (): ColorScheme => Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
const store = createAppearanceStore({
  // Browser previews keep device preferences in memory, never localStorage.
  read: () => Platform.OS === 'web' ? Promise.resolve(null) : SecureStore.getItemAsync(STORAGE_KEY),
  write: value => Platform.OS === 'web' ? Promise.resolve() : SecureStore.setItemAsync(STORAGE_KEY, value),
}, systemScheme());

export function useAppearance() {
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), setAppearance: store.setPreference };
}

/** A single OS subscription. Theme changes do not remount navigation or chats. */
export function useInitializeAppearance() {
  useEffect(() => {
    void store.restore().catch(() => undefined);
    const appearance = Appearance.addChangeListener(({ colorScheme }) => {
      store.updateSystem(colorScheme === 'dark' ? 'dark' : 'light');
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') store.updateSystem(systemScheme());
    });
    return () => { appearance.remove(); appState.remove(); };
  }, []);
}
