import type { BridgeSession } from './api';

export type SessionFilter = 'all' | 'scheduled' | 'chat' | 'other';

/** Exact server metadata only: no inference from user-authored titles. */
export function sessionKind(row: BridgeSession): Exclude<SessionFilter, 'all'> {
  if (row.source === 'cron' || /^cron_.+_\d{8}_\d{6}$/.test(row.id)) return 'scheduled';
  if (row.source === 'api_server' || row.source === 'api-server') return 'chat';
  return 'other';
}

export function mergeSessions(previous: BridgeSession[], incoming: BridgeSession[]): BridgeSession[] {
  const rows = new Map(previous.map(row => [`${row.bot}\0${row.id}`, row]));
  for (const row of incoming) rows.set(`${row.bot}\0${row.id}`, row);
  return [...rows.values()].sort((a, b) => b.lastActive - a.lastActive || a.id.localeCompare(b.id));
}

export function filterSessions(rows: BridgeSession[], filter: SessionFilter, query: string): BridgeSession[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => (filter === 'all' || sessionKind(row) === filter) &&
    (!needle || `${row.title} ${row.id} ${row.source ?? ''}`.toLocaleLowerCase().includes(needle)));
}
