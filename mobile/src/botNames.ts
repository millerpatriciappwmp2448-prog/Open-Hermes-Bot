/**
 * Hermes profile names for new bots.
 *
 * The bridge accepts `^[a-z0-9][a-z0-9_-]{0,63}$` and reserves a few names. A
 * display name such as "写作助手" has no ASCII letters at all, so the profile
 * name falls back to `bot-xxxx`; the display name is sent separately as the
 * title and is what the app shows.
 */

export const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const RESERVED_PROFILE_NAMES: readonly string[] = ['default', 'hermes', 'test', 'tmp', 'root', 'sudo'];

function asciiSlug(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 40)
    .replace(/[-_]+$/g, '');
}

function randomSuffix(random: () => number): string {
  return Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
}

/** A valid, unused profile name derived from the display name. */
export function profileNameFor(
  label: string,
  taken: readonly string[],
  random: () => number = Math.random,
): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  const free = (name: string) =>
    PROFILE_NAME.test(name) && !used.has(name) && !RESERVED_PROFILE_NAMES.includes(name);

  const base = asciiSlug(label);
  if (base && PROFILE_NAME.test(base)) {
    if (free(base)) return base;
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${base}-${index}`;
      if (free(candidate)) return candidate;
    }
  }
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = `bot-${randomSuffix(random)}`;
    if (free(candidate)) return candidate;
  }
  return `bot-${Date.now().toString(36)}`;
}
