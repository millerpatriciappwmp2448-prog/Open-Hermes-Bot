export type DictationPhase = 'idle' | 'starting' | 'listening' | 'finishing';
export type DictationError = 'permission' | 'unavailable' | 'network' | 'no-speech'
  | 'unsupported-language' | 'interrupted' | 'busy' | 'unknown';
export type DictationState = { phase: DictationPhase; transcript: string; volume: number };

type Permission = { granted: boolean; canAskAgain: boolean };
type SpeechEvent = {
  isFinal?: boolean;
  results?: { transcript: string }[];
  value?: number;
  error?: string;
};
export type DictationRecognizer = {
  isRecognitionAvailable(): boolean;
  getPermissionsAsync(): Promise<Permission>;
  requestPermissionsAsync(): Promise<Permission>;
  addListener(event: string, listener: (event: SpeechEvent) => void): { remove(): void };
  start(options: {
    lang: string; interimResults: boolean; continuous: boolean; addsPunctuation: boolean;
    volumeChangeEventOptions: { enabled: boolean; intervalMillis: number };
  }): void;
  stop(): void;
  abort(): void;
};
type Timer = ReturnType<typeof setTimeout>;
type Session = {
  recognizer: DictationRecognizer;
  subscriptions: { remove(): void }[];
  final: string;
  partial: string;
  settled: boolean;
  errorReported: boolean;
  finishTimer?: Timer;
  limitTimer?: Timer;
};

function errorCategory(error?: string): DictationError | null {
  switch (error) {
    case 'aborted': return null;
    case 'not-allowed': return 'permission';
    // iOS reports Siri & Dictation switched off as a service error, not a denial.
    case 'service-not-allowed': return 'unavailable';
    case 'network': return 'network';
    case 'no-speech': case 'speech-timeout': return 'no-speech';
    case 'language-not-supported': case 'bad-grammar': return 'unsupported-language';
    case 'audio-capture': case 'interrupted': return 'interrupted';
    case 'busy': case 'too-many-requests': return 'busy';
    default: return 'unknown';
  }
}

export function createDictation(options: {
  getRecognizer(): Promise<DictationRecognizer | null>;
  onState(state: DictationState): void;
  onText(text: string): void;
  onError(error: DictationError): void;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}) {
  const clock = options.timers ?? { setTimeout, clearTimeout };
  let state: DictationState = { phase: 'idle', transcript: '', volume: 0 };
  let generation = 0;
  let disposed = false;
  // Native speech events have no request ID. Keep ownership until native `end`,
  // even after our UI deadline, so an old result cannot reach a new draft.
  let session: Session | null = null;
  let locale = 'en-US';
  const publish = (patch: Partial<DictationState>) => {
    state = { ...state, ...patch };
    if (!disposed) options.onState(state);
  };
  const join = (left: string, right: string) => {
    if (!left) return right;
    if (!right || left === right || left.endsWith(right)) return left;
    if (right.startsWith(left)) return right;
    return `${left}${locale.startsWith('zh') ? '' : ' '}${right}`;
  };
  const transcript = (s: Session) => join(s.final, s.partial).trim();
  const clearTimers = (s: Session) => {
    if (s.finishTimer !== undefined) clock.clearTimeout(s.finishTimer);
    if (s.limitTimer !== undefined) clock.clearTimeout(s.limitTimer);
    s.finishTimer = s.limitTimer = undefined;
  };
  const settle = (s: Session, keep: boolean) => {
    if (s.settled) return;
    s.settled = true;
    clearTimers(s);
    const text = transcript(s);
    publish({ phase: 'idle', transcript: '', volume: 0 });
    if (keep && text && !disposed) options.onText(text);
  };
  const release = (s: Session) => {
    clearTimers(s);
    s.subscriptions.forEach(subscription => subscription.remove());
    s.subscriptions = [];
    if (session === s) session = null;
  };
  const abort = (s: Session) => {
    try { s.recognizer.abort(); } catch { release(s); }
  };
  const finish = () => {
    if (disposed) return;
    const s = session;
    if (!s) {
      generation++;
      publish({ phase: 'idle', transcript: '', volume: 0 });
      return;
    }
    if (s.settled || s.finishTimer !== undefined) return;
    publish({ phase: 'finishing' });
    s.finishTimer = clock.setTimeout(() => { settle(s, true); abort(s); }, 1200);
    try { s.recognizer.stop(); } catch { settle(s, true); abort(s); }
  };
  const cancel = () => {
    generation++;
    if (session) {
      const s = session;
      settle(s, false);
      abort(s);
    } else publish({ phase: 'idle', transcript: '', volume: 0 });
  };

  return {
    async start(lang: string) {
      if (disposed || session || state.phase !== 'idle') return;
      const request = ++generation;
      const current = () => !disposed && request === generation;
      locale = lang;
      publish({ phase: 'starting', transcript: '', volume: 0 });
      try {
        const recognizer = await options.getRecognizer();
        if (!current()) return;
        if (!recognizer || !recognizer.isRecognitionAvailable()) {
          publish({ phase: 'idle' }); options.onError('unavailable'); return;
        }
        let permission = await recognizer.getPermissionsAsync();
        if (!current()) return;
        if (!permission.granted && permission.canAskAgain) {
          permission = await recognizer.requestPermissionsAsync();
          if (!current()) return;
        }
        if (!permission.granted) {
          publish({ phase: 'idle' }); options.onError('permission'); return;
        }
        const s: Session = {
          recognizer, subscriptions: [], final: '', partial: '', settled: false, errorReported: false,
        };
        session = s;
        const listen = (event: string, callback: (event: SpeechEvent) => void) => {
          s.subscriptions.push(recognizer.addListener(event, payload => {
            if (!disposed && session === s) callback(payload);
          }));
        };
        listen('end', () => { settle(s, true); release(s); });
        listen('start', () => { if (!s.settled && state.phase === 'starting') publish({ phase: 'listening' }); });
        listen('result', event => {
          if (s.settled) return;
          const text = event.results?.[0]?.transcript?.trim();
          if (!text) return;
          if (event.isFinal) { s.final = join(s.final, text); s.partial = ''; }
          else s.partial = text;
          publish({ transcript: transcript(s) });
        });
        listen('volumechange', event => {
          if (!s.settled) publish({ volume: Math.max(0, Math.min(1, (event.value ?? 0) / 10)) });
        });
        const fail = (error: DictationError | null) => {
          if (s.settled) return;
          if (error && !s.errorReported) { s.errorReported = true; options.onError(error); }
          finish();
        };
        listen('error', event => fail(errorCategory(event.error)));
        listen('nomatch', () => fail('no-speech'));
        s.limitTimer = clock.setTimeout(finish, 55000);
        recognizer.start({
          lang, interimResults: true, continuous: true, addsPunctuation: true,
          volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
        });
      } catch {
        if (!current()) return;
        if (session) { const s = session; settle(s, false); abort(s); }
        else publish({ phase: 'idle', transcript: '', volume: 0 });
        options.onError('unknown');
      }
    },
    finish,
    cancel,
    background: finish,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      if (session) { const s = session; settle(s, false); abort(s); release(s); }
    },
  };
}
