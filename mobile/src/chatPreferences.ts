import type { BridgeSession } from './api';

export type ChatPreferences = { tapbacks: boolean; notifications: boolean; readAloud: boolean };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function readChatPreferences(prefs: Record<string, unknown>, profile: string): ChatPreferences {
  const saved = record(record(prefs.mobileChatPreferences)[profile]);
  return {
    tapbacks: typeof saved.tapbacks === 'boolean' ? saved.tapbacks : true,
    notifications: typeof saved.notifications === 'boolean' ? saved.notifications : true,
    readAloud: saved.readAloud === true,
  };
}

/** Keep each bot's choice on its host without replacing any other preferences. */
export function withChatPreferences(
  prefs: Record<string, unknown>, profile: string, value: Partial<ChatPreferences>,
): Record<string, unknown> {
  const chats = record(prefs.mobileChatPreferences);
  return {
    ...prefs,
    mobileChatPreferences: { ...chats, [profile]: { ...record(chats[profile]), ...readChatPreferences(prefs, profile), ...value } },
  };
}

export function sessionsForBot(rows: BridgeSession[], botId: string): BridgeSession[] {
  return rows.filter(row => row.bot === botId)
    .sort((left, right) => right.lastActive - left.lastActive);
}
