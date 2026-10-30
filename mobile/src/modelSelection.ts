import type { BridgeModels } from './api';

export type ModelRef = { model: string; provider: string };
export type ModelChoice = ModelRef & { label: string; providerName: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function ref(value: unknown): ModelRef | undefined {
  const raw = record(value);
  if (typeof raw.model !== 'string' || !raw.model.trim()) return;
  return { model: raw.model, provider: typeof raw.provider === 'string' ? raw.provider : '' };
}

/** Same profile keys and preference block as the desktop app; never a global fallback. */
export function readModelPick(prefs: Record<string, unknown>, profile: string): ModelRef | undefined {
  return ref(record(prefs.picks)[profile]) ?? ref(record(prefs.defaults)[profile])
    ?? (profile === 'default' ? ref(prefs.default) : undefined);
}

export function withModelPick(prefs: Record<string, unknown>, profile: string, pick: ModelRef | null): Record<string, unknown> {
  const picks = { ...record(prefs.picks) };
  const defaults = { ...record(prefs.defaults) };
  const next: Record<string, unknown> = { ...prefs, picks, defaults };
  if (pick) picks[profile] = pick;
  else {
    delete picks[profile];
    delete defaults[profile];
    if (profile === 'default') delete next.default;
  }
  return next;
}

/** Pin the actual bot's choice, including when returning from a session override to its server default. */
export function modelForTurn(pick?: ModelRef, options?: BridgeModels): { model?: string; provider?: string } {
  const chosen = pick ?? (options?.current ? { model: options.current, provider: options.currentProvider } : undefined);
  return chosen ? { model: chosen.model, ...(chosen.provider ? { provider: chosen.provider } : {}) } : {};
}

export function modelChoices(options?: BridgeModels): ModelChoice[] {
  if (!options) return [];
  const choices = options.providers.flatMap(provider => provider.models.map(model => ({
    model: model.id, provider: provider.slug, label: model.name, providerName: provider.name,
  })));
  if (options.current && !choices.some(choice => choice.model === options.current && choice.provider === options.currentProvider)) {
    choices.unshift({ model: options.current, provider: options.currentProvider, label: options.current, providerName: options.currentProvider });
  }
  return choices;
}
