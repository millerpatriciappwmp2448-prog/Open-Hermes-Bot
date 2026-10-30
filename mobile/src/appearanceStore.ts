export type ColorScheme = 'light' | 'dark';
export type ThemeName = ColorScheme | 'ivory';
export type AppearancePreference = ThemeName | 'system';
type Snapshot = { preference: AppearancePreference; scheme: ColorScheme; saveError: boolean; ready: boolean };

/** Device appearance is independent of the server's conversation preferences. */
export function createAppearanceStore(storage: {
  read: () => Promise<string | null>;
  write: (value: AppearancePreference) => Promise<void>;
}, initialScheme: ColorScheme) {
  let system = initialScheme;
  let revision = 0;
  let writes = Promise.resolve();
  let snapshot: Snapshot = { preference: 'system', scheme: system, saveError: false, ready: false };
  const listeners = new Set<() => void>();
  function publish(next: Partial<Snapshot>) {
    const preference = next.preference ?? snapshot.preference;
    snapshot = { ...snapshot, ...next, preference, scheme: preference === 'system' ? system : preference === 'ivory' ? 'light' : preference };
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async restore() {
      const initialRevision = revision;
      try {
        const saved = await storage.read();
        if (revision === initialRevision && (saved === 'system' || saved === 'light' || saved === 'dark' || saved === 'ivory')) {
          publish({ preference: saved });
        }
      } finally { publish({ ready: true }); }
    },
    updateSystem(scheme: ColorScheme) {
      if (system !== scheme) { system = scheme; publish({}); }
    },
    setPreference(preference: AppearancePreference) {
      const writeRevision = ++revision;
      publish({ preference, saveError: false });
      // Serialize writes so rapid taps cannot restore an older choice on launch.
      writes = writes.then(async () => {
        try { await storage.write(preference); }
        catch { if (revision === writeRevision) publish({ saveError: true }); }
      });
      return writes;
    },
  };
}
