/** Transport lifetime is independent of a Hermes run's lifetime. */
export type RunSnapshot = {
  status: string; text?: string; tool?: string; error?: string; sessionId?: string;
};
export type TurnWatch = { pause(): void; resume(): void; detach(): void; stop(): void };

export function watchTurn(
  transport: { start(): Promise<RunSnapshot>; read(): Promise<RunSnapshot>; stop(): Promise<unknown> },
  handlers: { snapshot(run: RunSnapshot): void; done(text: string): void; error(error: unknown): void; reconnecting?(): void },
  clock = { later: (fn: () => void, ms: number) => setTimeout(fn, ms), cancel: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) },
): TurnWatch {
  let accepted = false, ended = false, paused = false, busy = false, wake = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopRequested = false;
  const clear = () => { if (timer !== undefined) clock.cancel(timer); timer = undefined; };
  const tick = async () => {
    clear();
    if (ended || paused) return;
    if (busy) { wake = true; return; }
    busy = true;
    try {
      const run = await (accepted ? transport.read() : transport.start());
      accepted = true;
      failures = 0;
      if (stopRequested) { void transport.stop().catch(() => {}); return; }
      if (ended) return;
      handlers.snapshot(run);
      if (run.status === 'completed') { ended = true; handlers.done(run.text || ''); }
      else if (['failed', 'interrupted', 'unknown'].includes(run.status)) {
        ended = true; handlers.error({ code: 'turn_failed', message: run.error || run.status });
      } else if (run.status === 'cancelled') { ended = true; handlers.done(run.text || ''); }
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
      stopRequested = true; ended = true; clear();
      if (accepted) void transport.stop().catch(() => {});
      // An in-flight acceptance is stopped by tick after its response arrives.
    },
  };
}
