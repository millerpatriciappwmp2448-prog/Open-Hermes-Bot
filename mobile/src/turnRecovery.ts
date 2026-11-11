/** Transport lifetime is independent of a Hermes run's lifetime. */
export type RunSnapshot = {
  status: string; text?: string; tool?: string; error?: string; sessionId?: string;
};
export type TurnWatch = { pause(): void; resume(): void; detach(): void; stop(): void };

export function watchTurn<T extends RunSnapshot = RunSnapshot>(
  transport: { start(): Promise<T>; read(): Promise<T>; stop(): Promise<unknown> },
  handlers: { snapshot(run: T): void; done(text: string, status: 'completed' | 'cancelled'): void; error(error: unknown): void; reconnecting?(): void },
  clock = { later: (fn: () => void, ms: number) => setTimeout(fn, ms), cancel: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) },
): TurnWatch {
  let accepted = false, ended = false, paused = false, busy = false, wake = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopRequested = false, stopAcknowledged = false;
  const clear = () => { if (timer !== undefined) clock.cancel(timer); timer = undefined; };
  const consume = (run: T) => {
    if (ended) return;
    handlers.snapshot(run);
    if (run.status === 'completed') { ended = true; handlers.done(run.text || '', 'completed'); }
    else if (['failed', 'interrupted', 'unknown'].includes(run.status)) {
      ended = true; handlers.error({ code: 'turn_failed', message: run.error || run.status });
    } else if (run.status === 'cancelled') { ended = true; handlers.done(run.text || '', 'cancelled'); }
  };
  const tick = async () => {
    clear();
    if (ended || paused) return;
    if (busy) { wake = true; return; }
    busy = true;
    try {
      const run = await (accepted ? transport.read() : transport.start());
      accepted = true;
      failures = 0;
      if (ended) return;
      consume(run);
      if (!ended && stopRequested && !stopAcknowledged) {
        const result = await transport.stop();
        stopAcknowledged = true;
        // The acknowledgement may still say "running". Only a terminal
        // snapshot ends observation; a lost response retries the same stop.
        if (result && typeof result === 'object' && 'status' in result && typeof result.status === 'string') consume(result as T);
      }
    } catch (error) {
      if (ended) return;
      const fault = error as { status?: number; code?: string };
      if (fault.status && fault.status < 500 && ![408, 429].includes(fault.status)) {
        ended = true; handlers.error(error);
      } else {
        failures++; handlers.reconnecting?.();
      }
    } finally {
      busy = false;
      if (!ended && !paused) {
        const delay = wake ? 0 : failures ? Math.min(15000, 1000 * 2 ** Math.min(failures, 4)) : 1200;
        wake = false;
        timer = clock.later(() => { void tick(); }, delay);
      }
    }
  };
  void tick();
  return {
    pause() { paused = true; clear(); },
    resume() { if (ended) return; paused = false; void tick(); },
    detach() { ended = true; clear(); },
    stop() {
      if (ended || stopRequested) return;
      stopRequested = true;
      if (!paused) void tick();
    },
  };
}
