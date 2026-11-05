export type SpokenReply = {
  host: string; botId: string; threadId: string; sessionId: string; requestId: string; text: string;
};
type SpeechState = { host?: string; enabled: boolean; foreground: boolean; viewingThread: string | null };
export type SpeechCallbacks = { onDone(): void; onStopped(): void; onError(error: Error): void };

/** Respect the native input limit without truncating the reply or dividing a surrogate pair. */
export function speechChunks(text: string, limit: number): string[] {
  const size = Math.max(2, Math.min(3000, Math.floor(limit) || 3000));
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      // Prefer a sentence/word boundary in the latter half of the chunk.
      for (let i = end; i > start + size / 2; i--) {
        if (/[\s。！？.!?]/.test(text[i - 1])) { end = i; break; }
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Own only speech started by this store. Late native callbacks cannot revive a stopped reply. */
export function createReplySpeaker(device: {
  state(reply: SpokenReply): SpeechState;
  maxLength: number;
  speak(text: string, callbacks: SpeechCallbacks): void;
  stop(): Promise<unknown>;
}) {
  const handled = new Set<string>();
  let generation = 0;
  let current: SpokenReply | null = null;
  let stopWork: Promise<unknown> = Promise.resolve();
  const eligible = (reply: SpokenReply) => {
    const state = device.state(reply);
    return state.enabled && state.foreground && state.host === reply.host && state.viewingThread === reply.threadId;
  };
  const stopDevice = () => {
    stopWork = stopWork.catch(() => undefined).then(() => device.stop());
    // Native audio errors must never become unhandled reply failures.
    void stopWork.catch(() => undefined);
    return stopWork;
  };
  const cancel = () => {
    generation++;
    if (!current) return;
    current = null;
    void stopDevice();
  };
  return {
    cancel,
    reconcile() { if (current && !eligible(current)) cancel(); },
    async complete(reply: SpokenReply) {
      const key = JSON.stringify([reply.host, reply.botId, reply.sessionId, reply.requestId]);
      if (handled.has(key)) return;
      handled.add(key);
      if (handled.size > 512) handled.delete(handled.values().next().value!);
      if (!eligible(reply) || !reply.text.trim()) return;
      const own = ++generation;
      current = reply;
      try {
        // Serialize native stops before starting the next utterance.
        await stopDevice();
        const chunks = speechChunks(reply.text, device.maxLength);
        let index = 0;
        const next = () => {
          if (own !== generation || current !== reply) return;
          if (!eligible(reply)) { cancel(); return; }
          if (index >= chunks.length) { current = null; return; }
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (own === generation && current === reply) { generation++; current = null; }
          };
          const done = () => { if (!settled) { settled = true; next(); } };
          try { device.speak(chunks[index++], { onDone: done, onStopped: finish, onError: finish }); }
          catch { finish(); }
        };
        next();
      } catch {
        if (own === generation) { generation++; current = null; }
      }
    },
  };
}
