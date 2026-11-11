/** A local reply alert carries routing IDs, never message text or credentials. */
export type ReplyNotice = {
  host: string; botId: string; threadId: string; sessionId: string; requestId: string; name: string;
  groupId?: string;
};
export type ReplyNotification = ReplyNotice & { kind: 'hermes-reply' };
type NoticeState = { enabled: boolean; foreground: boolean; viewingThread: string | null };

export function notificationTarget(value: unknown): ReplyNotification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== 'hermes-reply') return null;
  for (const key of ['host', 'botId', 'threadId', 'sessionId', 'requestId', 'name']) {
    if (typeof row[key] !== 'string' || !(row[key] as string).trim() || (row[key] as string).length > 2048) return null;
  }
  if (row.groupId !== undefined) {
    if (typeof row.groupId !== 'string' || !/^g-[a-zA-Z0-9-]{1,100}$/.test(row.groupId) || row.threadId !== row.groupId) return null;
  } else if (row.threadId !== `bot:${row.botId}`) return null;
  return row as ReplyNotification;
}

export function createReplyNotifier(device: {
  state(notice: ReplyNotice): NoticeState;
  allowed(): Promise<boolean>;
  present(notice: ReplyNotification): Promise<unknown>;
}) {
  const handled = new Set<string>();
  const skip = (notice: ReplyNotice) => {
    const state = device.state(notice);
    if (!state.enabled) return 'muted' as const;
    if (state.foreground && state.viewingThread === notice.threadId) return 'viewing' as const;
    return null;
  };
  return {
    async complete(notice: ReplyNotice) {
      const key = JSON.stringify([notice.host, notice.botId, notice.threadId, notice.sessionId, notice.requestId]);
      if (handled.has(key)) return 'duplicate' as const;
      // Reserve before crossing the native boundary: concurrent recovery polls
      // must not notify twice. This ledger never stores conversation content.
      handled.add(key);
      if (handled.size > 512) handled.delete(handled.values().next().value!);
      try {
        const reason = skip(notice);
        if (reason) return reason;
        if (!await device.allowed()) return 'denied' as const;
        const changed = skip(notice);
        if (changed) return changed;
        await device.present({ ...notice, kind: 'hermes-reply' });
        return 'sent' as const;
      } catch {
        // A denied OS service can never turn a completed Hermes reply into an error.
        return 'failed' as const;
      }
    },
  };
}
