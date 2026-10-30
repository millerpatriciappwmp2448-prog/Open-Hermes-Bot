import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

// Share the OS subscriptions across all avatars. Start still until the system's
// accessibility preference is known, including on the first frame after launch.
const MotionContext = createContext(false);

export function AvatarMotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    let mounted = true;
    let changed = false;
    const reduce = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !changed) setReduced(value);
    }).catch(() => {});
    const state = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => { mounted = false; reduce.remove(); state.remove(); };
  }, []);

  return <MotionContext.Provider value={foreground && !reduced}>{children}</MotionContext.Provider>;
}

export function useAvatarMotion() {
  return useContext(MotionContext);
}
