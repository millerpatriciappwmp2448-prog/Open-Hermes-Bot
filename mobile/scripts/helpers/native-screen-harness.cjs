const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const babel = require('@babel/core');
const React = require('react');

// Keep React hooks and app components real; only replace native/Expo bindings.
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
global.IS_REACT_ACT_ENVIRONMENT = true;

const keyboardEvents = new EventEmitter();
class NativeEventEmitter {
  addListener(event, listener) {
    keyboardEvents.on(event, listener);
    return { remove: () => keyboardEvents.off(event, listener) };
  }
  removeAllListeners(event) { keyboardEvents.removeAllListeners(event); }
}

// Load the installed RN implementation so receiver-sensitive methods behave
// exactly as they do on a phone, rather than using RN Web's Keyboard facade.
const keyboardFile = require.resolve('react-native/Libraries/Components/Keyboard/Keyboard');
const keyboardCode = babel.transformSync(fs.readFileSync(keyboardFile, 'utf8'), {
  filename: keyboardFile,
  configFile: false,
  babelrc: false,
  plugins: [
    'babel-plugin-syntax-hermes-parser',
    '@babel/plugin-transform-flow-strip-types',
    '@babel/plugin-transform-modules-commonjs',
  ],
}).code;
const keyboardModule = { exports: {} };
new Function('require', 'module', 'exports', keyboardCode)((name) => {
  if (name.endsWith('/NativeEventEmitter')) return NativeEventEmitter;
  if (name.endsWith('/Platform')) return { OS: 'ios' };
  if (name.endsWith('/NativeKeyboardObserver')) return {};
  if (name.endsWith('/dismissKeyboard')) return () => {};
  if (name.endsWith('/LayoutAnimation')) return { configureNext() {}, Types: {} };
  throw new Error(`Unexpected Keyboard dependency: ${name}`);
}, keyboardModule, keyboardModule.exports);
const Keyboard = keyboardModule.exports.default;

const frames = new Map();
let frameId = 0;
global.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
global.cancelAnimationFrame = (id) => frames.delete(id);
// React Native aliases window to globalThis, without DOM event methods.
global.window = globalThis;

class Value {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
  interpolate({ outputRange }) { return outputRange[0]; }
  stopAnimation() {}
}
const animation = () => ({ start: (done) => done?.({ finished: true }), stop() {} });
const appStateEvents = new EventEmitter();
const alerts = [];
let settingsOpened = 0;
const native = {
  Keyboard,
  Platform: { OS: 'ios', select: (choices) => choices[native.Platform.OS] ?? choices.default },
  StyleSheet: { create: (styles) => styles, absoluteFill: { position: 'absolute', inset: 0 } },
  useWindowDimensions: () => ({ width: 393, height: 852 }),
  AppState: {
    currentState: 'active',
    addEventListener(event, listener) {
      appStateEvents.on(event, listener);
      return { remove: () => appStateEvents.off(event, listener) };
    },
  },
  Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) },
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => true,
    addEventListener: () => ({ remove() {} }),
  },
  Alert: { alert(...args) { alerts.push(args); } },
  Share: { share: async () => ({ action: 'dismissedAction' }) },
  Linking: { openSettings: async () => { settingsOpened++; } },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Easing: { quad: (x) => x * x, in: (fn) => fn, out: (fn) => fn },
  Animated: {
    Value, View: 'Animated.View', Text: 'Animated.Text',
    timing: animation, spring: animation, parallel: animation, sequence: animation,
    loop: () => ({ start() {}, stop() {} }),
  },
  Modal: ({ children, ...props }) => React.createElement('Modal', props, props.visible ? children : null),
};
for (const name of ['View', 'Text', 'TextInput', 'ScrollView', 'Pressable', 'KeyboardAvoidingView', 'ActivityIndicator', 'Switch']) {
  native[name] = name;
}

const navigation = { navigate() {}, goBack() {} };
let focused = true;
const savedPreferences = new Map();
const notificationCalls = { presented: [], permissionRequests: 0 };
const speechCalls = { spoken: [], stops: 0 };
const speechNative = {
  maxSpeechInputLength: 4000,
  speak: (text, options) => { speechCalls.spoken.push({ text, options }); },
  stop: async () => { speechCalls.stops++; },
};
// A fake of expo-speech-recognition's native module: tests drive its events.
const dictationNative = new EventEmitter();
function resetDictation() {
  dictationNative.removeAllListeners();
  Object.assign(dictationNative, {
    available: true,
    permission: { granted: true, canAskAgain: true },
    requestResult: { granted: true, canAskAgain: true },
    starts: [], stops: 0, aborts: 0, permissionRequests: 0,
  });
}
resetDictation();
Object.assign(dictationNative, {
  isRecognitionAvailable() { return dictationNative.available; },
  async getPermissionsAsync() { return dictationNative.permission; },
  async requestPermissionsAsync() {
    dictationNative.permissionRequests++;
    return dictationNative.requestResult;
  },
  addListener(event, listener) {
    dictationNative.on(event, listener);
    return { remove: () => dictationNative.off(event, listener) };
  },
  start(opts) { dictationNative.starts.push({ opts, stopsAtStart: speechCalls.stops }); },
  stop() { dictationNative.stops++; },
  abort() {
    dictationNative.aborts++;
    dictationNative.emit('error', { error: 'aborted' });
    dictationNative.emit('end', {});
  },
});
const notificationNative = {
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { DEFAULT: 3 }, DEFAULT_ACTION_IDENTIFIER: 'default',
  getPermissionsAsync: async () => ({ granted: true, canAskAgain: true, ios: { status: 2 } }),
  requestPermissionsAsync: async () => { notificationCalls.permissionRequests++; return { granted: true, ios: { status: 2 } }; },
  setNotificationChannelAsync: async () => {},
  scheduleNotificationAsync: async value => { notificationCalls.presented.push(value); return value.identifier; },
  setNotificationHandler(value) { notificationCalls.handler = value; },
  addNotificationResponseReceivedListener(fn) { notificationCalls.listener = fn; return { remove() { delete notificationCalls.listener; } }; },
  getLastNotificationResponse: () => null,
  clearLastNotificationResponseAsync: async () => {},
};
const modules = {
  'react-native': native,
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
  '@react-navigation/native': { useIsFocused: () => focused, useNavigation: () => navigation },
  'react-native-svg': {
    __esModule: true, default: 'Svg',
    ...Object.fromEntries(['Svg', 'Circle', 'Defs', 'G', 'LinearGradient', 'Mask', 'Path', 'Rect', 'Stop'].map((name) => [name, name])),
  },
  'expo-secure-store': {
    getItemAsync: async (key) => savedPreferences.get(key) ?? null,
    setItemAsync: async (key, value) => { savedPreferences.set(key, value); },
  },
  'expo-haptics': { selectionAsync: async () => {} },
  'expo-clipboard': { setStringAsync: async () => {} },
  'expo-image-picker': { MediaTypeOptions: { Images: 'images' } },
  'expo-document-picker': {},
  'expo-notifications': notificationNative,
  'expo-speech': speechNative,
  'expo-speech-recognition': { ExpoSpeechRecognitionModule: dictationNative },
};
let store;
const originalLoad = Module._load;
const storeFile = path.resolve(__dirname, '../../src/store.tsx');
Module._load = function (request, parent, isMain) {
  if (Object.hasOwn(modules, request)) return modules[request];
  if (request === '../store' && Module._resolveFilename(request, parent) === storeFile) {
    return { useStore: () => store };
  }
  return originalLoad.call(this, request, parent, isMain);
};

module.exports = {
  native, keyboardEvents, navigation, savedPreferences, notificationNative, notificationCalls,
  speechNative, speechCalls, appStateEvents, alerts, dictationNative, resetDictation,
  settingsCalls: () => settingsOpened,
  setFocused: (value) => { focused = value; },
  setStore: (value) => { store = value; },
  pendingFrames: () => frames.size,
  flushFrames() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  },
  createNodeMock: () => ({
    measureInWindow: (callback) => callback(20, 300, 350, 44),
    scrollToEnd() {}, blur() {}, focus() {},
  }),
};
