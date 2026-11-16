export type CodexChat = {
  id: string;
  kind?: string;
  hostId?: string;
  title: string;
  status?: { type: string; activeFlags?: string[] };
  cwd?: string;
  project?: string;
  messages?: CodexChatMessage[];
  summary?: string;
  projectId?: string | null;
  updatedAt?: number;
  pinnedIndex?: number | null;
  isUnread?: boolean;
};

export type CodexChatMessage = { role: string; phase?: 'final' | 'progress'; content: string };

export type CodexProject = { id: string; name: string; kind?: 'pinned' | 'project' | 'standalone'; chats: CodexChat[] };

export type CodexSidebar = {
  threads: CodexChat[];
  sections: { id: string; name: string; items: string[] }[];
  projects: { id: string; label: string; path: string }[];
  sorting?: { chats?: string; projects?: string };
  nextCursor?: string | null;
  historyUnavailable?: boolean;
};

/** Refresh replaces the list; older pages must not overwrite live metadata. */
export function mergeCodexSidebar(current: CodexSidebar | null, page: CodexSidebar, append = false): CodexSidebar {
  if (!current || !append) return page;
  const threads = new Map<string, CodexChat>();
  for (const row of [...current.threads, ...page.threads]) {
    if (!threads.has(row.id)) threads.set(row.id, row);
  }
  return { ...current, threads: [...threads.values()], nextCursor: page.nextCursor };
}

/** Keep project IDs separate from labels; a cwd alone does not imply membership. */
export function orderCodexSidebar(sidebar: CodexSidebar): CodexProject[] {
  const byId = new Map(sidebar.threads.map(thread => [thread.id, thread]));
  const pinned = sidebar.threads.filter(thread => thread.pinnedIndex !== null && thread.pinnedIndex !== undefined)
    .sort((a, b) => (a.pinnedIndex || 0) - (b.pinnedIndex || 0));
  const projects = new Map(sidebar.projects.map(project => [project.id, project]));
  const taskSection = sidebar.sections.find(section => section.name.toLowerCase() === 'tasks' || section.id === 'chats');
  const groups: CodexProject[] = [];
  if (pinned.length) groups.push({ id: 'pinned', kind: 'pinned', name: '置顶', chats: pinned });
  const seen = new Set<string>(pinned.map(thread => thread.id));
  const projectIds = new Set([
    ...sidebar.sections.flatMap(section => section.items).filter(key => key.startsWith('codex:project:')).map(key => key.slice('codex:project:'.length)),
    ...sidebar.projects.map(project => project.id),
    ...sidebar.threads.flatMap(thread => thread.projectId ? [thread.projectId] : []),
  ]);
  const sort = (chats: CodexChat[]) => sidebar.sorting?.chats === 'manual' ? chats :
    chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const id of projectIds) {
    const project = projects.get(id);
    const chats = sort(sidebar.threads.filter(thread => thread.projectId === id && !seen.has(thread.id)));
    chats.forEach(thread => seen.add(thread.id));
    groups.push({ id: `project:${id}`, kind: 'project', name: project?.label || project?.path?.split(/[\\/]/).filter(Boolean).pop() || id, chats });
  }
  const tasks = (taskSection?.items || []).map(key => key.replace(/^codex:thread:local:/, ''))
    .map(id => byId.get(id)).filter((thread): thread is CodexChat => Boolean(thread && !seen.has(thread.id)));
  const remaining = sort(sidebar.threads.filter(thread => !seen.has(thread.id) && !tasks.some(item => item.id === thread.id)));
  const taskChats = [...tasks, ...remaining];
  if (taskChats.length) groups.push({ id: 'standalone', kind: 'standalone', name: '独立会话', chats: taskChats });
  return groups;
}

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
  return [...groups].map(([name, list]) => ({ id: name, name, chats: list }));
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
