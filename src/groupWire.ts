// Shared with the phone bridge's groups.py. Records remain human-readable in
// Hermes, but quoted protocol lines cannot become separate speakers.
const MARKER = '@@hermes-message-v1 ';
export type GroupRecord = {
  id: string;
  kind: 'user' | 'member' | 'note';
  name: string;
  text: string;
};
const prefix = (kind: GroupRecord['kind'], name: string) =>
  kind === 'user' ? '@You: ' : kind === 'note' ? '(note) ' : `@${name}: `;

export function encodeGroupRecord({ id, kind, name, text }: GroupRecord): string {
  return MARKER + JSON.stringify({ id, kind, name, lines: text.split('\n').length }) + '\n' + prefix(kind, name) + text;
}

export function decodeGroupRecord(lines: string[], index: number): { record: GroupRecord; count: number } | null {
  if (!lines[index].startsWith(MARKER)) return null;
  try {
    const meta = JSON.parse(lines[index].slice(MARKER.length));
    if (!meta || !['user', 'member', 'note'].includes(meta.kind) || typeof meta.name !== 'string' ||
        typeof meta.id !== 'string' || !meta.id || !Number.isInteger(meta.lines) || meta.lines < 1 ||
        meta.lines > lines.length - index - 1) return null;
    const body = lines.slice(index + 1, index + 1 + meta.lines).join('\n');
    const start = prefix(meta.kind, meta.name);
    if (!body.startsWith(start)) return null;
    return { record: { id: meta.id, kind: meta.kind, name: meta.name, text: body.slice(start.length) }, count: meta.lines + 1 };
  } catch { return null; }
}
