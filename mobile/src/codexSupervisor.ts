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

export type CodexProject = { name: string; chats: CodexChat[] };

export type CodexSidebar = {
  threads: CodexChat[];
  sections: { id: string; name: string; items: string[] }[];
  projects: { id: string; label: string; path: string }[];
  sorting?: { chats?: string; projects?: string };
};

/** Keep the computer sidebar order: pinned, project sections, then task chats. */
export function orderCodexSidebar(sidebar: CodexSidebar): CodexProject[] {
  const byId = new Map(sidebar.threads.map(thread => [thread.id, thread]));
  const pinned = sidebar.threads.filter(thread => thread.pinnedIndex !== null && thread.pinnedIndex !== undefined)
    .sort((a, b) => (a.pinnedIndex || 0) - (b.pinnedIndex || 0));
  const projects = new Map(sidebar.projects.map(project => [project.id, project]));
  const projectSection = sidebar.sections.find(section => section.name.toLowerCase() === 'projects' || section.id === 'threads');
  const taskSection = sidebar.sections.find(section => section.name.toLowerCase() === 'tasks' || section.id === 'chats');
  const groups: CodexProject[] = [];
  if (pinned.length) groups.push({ name: '置顶', chats: pinned });
  const seen = new Set<string>(pinned.map(thread => thread.id));
  for (const key of projectSection?.items || []) {
    const id = key.replace(/^codex:project:/, '');
    const project = projects.get(id);
    const chats = sidebar.threads.filter(thread => thread.projectId === id && !seen.has(thread.id))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    chats.forEach(thread => seen.add(thread.id));
    if (chats.length) groups.push({ name: project?.label || project?.path?.split(/[\\/]/).filter(Boolean).pop() || id, chats });
  }
  const tasks = (taskSection?.items || []).map(key => key.replace(/^codex:thread:local:/, ''))
    .map(id => byId.get(id)).filter((thread): thread is CodexChat => Boolean(thread && !seen.has(thread.id)));
  const remaining = sidebar.threads.filter(thread => !seen.has(thread.id) && !tasks.some(item => item.id === thread.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const taskChats = [...tasks, ...remaining];
  if (taskChats.length) groups.push({ name: '任务', chats: taskChats });
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
