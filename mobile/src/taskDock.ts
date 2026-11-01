/**
 * The agent's task list as the bridge hands it over: Hermes' own `todo_list`,
 * read from the session. These helpers decide what the dock above the composer
 * shows, and stay free of React so they can be tested on their own.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TodoItem = { id: string; content: string; status: TodoStatus; parent?: string };

const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];

/** A list from the wire, with anything malformed left out. */
export function parseTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  const out: TodoItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const content = String(row.content ?? '').trim();
    if (!content) continue;
    const status = String(row.status ?? '') as TodoStatus;
    const item: TodoItem = {
      id: String(row.id ?? '').trim() || '?',
      content,
      status: STATUSES.includes(status) ? status : 'pending',
    };
    const parent = String(row.parent ?? '').trim();
    if (parent && parent !== item.id) item.parent = parent;
    out.push(item);
  }
  return out;
}

export type TodoCount = { done: number; total: number };

/** A cancelled step is settled too: it no longer waits for the agent. */
export function countTodos(todos: readonly TodoItem[]): TodoCount {
  const done = todos.filter(item => item.status === 'completed' || item.status === 'cancelled').length;
  return { done, total: todos.length };
}

/** The dock shows only while some step is still open. */
export function dockVisible(todos: readonly TodoItem[] | undefined): boolean {
  if (!todos || !todos.length) return false;
  const { done, total } = countTodos(todos);
  return done < total;
}

/** The step the header names: the one running, else the next one waiting. */
export function currentTodo(todos: readonly TodoItem[]): TodoItem | undefined {
  return todos.find(item => item.status === 'in_progress') ?? todos.find(item => item.status === 'pending');
}

/** Sub-steps sit one level in, under the step they belong to. */
export function todoDepth(todos: readonly TodoItem[], item: TodoItem): number {
  const byId = new Map(todos.map(each => [each.id, each]));
  let depth = 0;
  let node: TodoItem | undefined = item;
  const seen = new Set<string>([item.id]);
  while (node?.parent && byId.has(node.parent) && !seen.has(node.parent) && depth < 3) {
    seen.add(node.parent);
    node = byId.get(node.parent);
    depth += 1;
  }
  return depth;
}

export function sameTodos(a: readonly TodoItem[] | undefined, b: readonly TodoItem[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (item, index) =>
      item.id === b[index].id &&
      item.content === b[index].content &&
      item.status === b[index].status &&
      item.parent === b[index].parent,
  );
}
