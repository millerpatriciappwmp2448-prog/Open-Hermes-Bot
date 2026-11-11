export type CodexChat = {
  id: string;
  kind?: string;
  hostId?: string;
  title: string;
  status?: { type: string; activeFlags?: string[] };
  cwd?: string;
  project?: string;
  messages?: CodexChatMessage[];
};

export type CodexChatMessage = { role: string; phase?: 'final' | 'progress'; content: string };

export type CodexProject = { name: string; chats: CodexChat[] };

/** The project a Codex chat belongs to: the companion's name, else the cwd's last folder. */
export function chatProject(chat: CodexChat): string {
  if (chat.project && chat.project.trim()) return chat.project.trim();
  const parts = (chat.cwd || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/** Groups chats by project, keeping the companion's newest-first order within and across groups. */
export function groupChatsByProject(chats: CodexChat[]): CodexProject[] {
  const groups = new Map<string, CodexChat[]>();
  for (const chat of chats) {
    const name = chatProject(chat);
    const list = groups.get(name);
    if (list) list.push(chat); else groups.set(name, [chat]);
  }
  return [...groups].map(([name, list]) => ({ name, chats: list }));
}

/** Only the model's own words: assistant messages with text. */
export function modelOutput(chat: CodexChat): CodexChatMessage[] {
  return (chat.messages || []).filter(message => message.role === 'assistant' && message.content.trim());
}

export type CodexWatchSpec = {
  threadId: string;
  hostId: 'local';
  goal: string;
  profile: string;
  model?: string;
  provider?: string;
  reviewEnabled: boolean;
};

export type CodexSupervisorStatus = {
  enabled: boolean;
  state: string;
  spec?: CodexWatchSpec;
  attempts?: number;
  sampledAt?: number;
  connectionError?: string;
  observed?: { title: string; turnStatus: string; turnId: string; error?: unknown };
  outbox?: { dueAt: number; status: string; kind: string } | null;
  review?: { status: string; analysis?: string; recommendation?: string; action?: string; error?: string; at?: number };
  events?: { at: number; type: string; message: string }[];
};
