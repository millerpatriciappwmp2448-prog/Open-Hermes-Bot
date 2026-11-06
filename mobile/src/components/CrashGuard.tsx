import { Component, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

const KEY = 'hermes.last.error';
type Store = typeof import('expo-secure-store');
let secure: Store | null = null;
try { secure = Platform.OS === 'web' ? null : require('expo-secure-store'); } catch { secure = null; }

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${(error.stack || '').slice(0, 1500)}`;
  try { return String(error); } catch { return 'Unknown error'; }
}

export function rememberError(error: unknown, where: string) {
  const text = `[${where}] ${new Date().toISOString()}\n${describe(error)}`.slice(0, 1900);
  void secure?.setItemAsync(KEY, text).catch(() => undefined);
}

export async function readLastError(): Promise<string> {
  try { return (await secure?.getItemAsync(KEY)) || ''; } catch { return ''; }
}

/** Keeps uncaught JS errors from killing the app in release builds. */
export function installGlobalErrorHandler() {
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    rememberError(error, fatal ? 'fatal' : 'error');
    // Render errors reach CrashGuard; other async errors are logged and the app keeps running.
    if (__DEV__) previous(error, fatal);
    else console.warn('Hermes error', describe(error));
  });
}

type State = { error: string | null; attempt: number };

export class CrashGuard extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: describe(error) };
  }

  componentDidCatch(error: unknown) {
    rememberError(error, 'render');
  }

  render() {
    if (!this.state.error) return <View key={this.state.attempt} style={{ flex: 1 }}>{this.props.children}</View>;
    return (
      <View style={{ flex: 1, backgroundColor: '#f6f5f1', paddingTop: 70, paddingHorizontal: 20 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#222', marginBottom: 8 }}>出错了 / Something went wrong</Text>
        <ScrollView style={{ flex: 1, marginBottom: 16 }}>
          <Text selectable style={{ fontSize: 12, color: '#555', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{this.state.error}</Text>
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={() => this.setState(s => ({ error: null, attempt: s.attempt + 1 }))}
          style={{ backgroundColor: '#2b4a37', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 40 }}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>重试 / Retry</Text>
        </Pressable>
      </View>
    );
  }
}
