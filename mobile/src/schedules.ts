// What a bot runs on its own, and when.
//
// A schedule lives on the server, in Hermes' `cron/jobs.json`, and the
// gateway's scheduler runs it. The phone only reads the jobs, says where each
// one stands, and asks the bridge to create, pause, resume or run one.

import { t } from './i18n';

/** One job, as the Hermes gateway answers it. Every field is optional. */
export type HermesJob = {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  schedule?: { kind?: unknown; expr?: unknown; expression?: unknown; minutes?: unknown; display?: unknown } | string;
  schedule_display?: unknown;
  state?: unknown;
  enabled?: unknown;
  next_run_at?: unknown;
  last_run_at?: unknown;
  last_status?: unknown;
  last_error?: unknown;
  last_delivery_error?: unknown;
  deliver?: unknown;
  no_agent?: unknown;
  repeat?: { times?: unknown; completed?: unknown } | null;
};

export type ScheduleState = 'scheduled' | 'paused' | 'done' | 'failed' | 'unknown';

export type Schedule = {
  id: string;
  name: string;
  /** When it runs, in the server's own words. */
  when: string;
  expression: string;
  prompt: string;
  state: ScheduleState;
  /** Epoch milliseconds; 0 when none. */
  nextRun: number;
  lastRun: number;
  lastStatus: string;
  lastError: string;
  /** A run can succeed and still reach nobody; Hermes keeps the two apart. */
  lastDeliveryError: string;
  deliver: string;
  noAgent: boolean;
  completed: number;
};

function word(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** The server writes its own display line; an expression is in its timezone. */
export function scheduleText(job: HermesJob): string {
  const shown = word(job?.schedule_display);
  if (shown) return shown;
  const shape = job?.schedule;
  if (typeof shape === 'string') return shape.trim();
  if (!shape || typeof shape !== 'object') return '';
  const display = word(shape.display);
  if (display) return display;
  const expression = word(shape.expr ?? shape.expression);
  if (expression) return expression;
  const minutes = count(shape.minutes);
  if (minutes) {
    if (minutes % 1440 === 0) return t("每{0}天", { "0": minutes / 1440 });
    if (minutes % 60 === 0) return t("每{0}小时", { "0": minutes / 60 });
    return t("每{0}分钟", { "0": minutes });
  }
  return '';
}

/** A job added from a terminal can have a prompt and no name. */
export function scheduleName(job: HermesJob): string {
  const named = word(job?.name);
  if (named) return named;
  const asked = word(job?.prompt).split('\n')[0].trim();
  if (!asked) return t("未命名任务");
  return asked.length > 64 ? `${asked.slice(0, 61)}...` : asked;
}

export function scheduleState(job: HermesJob): ScheduleState {
  const state = word(job?.state).toLowerCase();
  const last = word(job?.last_status).toLowerCase();
  // The switch is the truth: a paused job keeps its old state word for a while.
  if (job?.enabled === false) return 'paused';
  if (state === 'paused') return 'paused';
  if (state === 'completed' || state === 'done' || state === 'finished') return 'done';
  if (state === 'error' || state === 'failed') return 'failed';
  if (state === 'scheduled' || state === 'active' || state === 'enabled') {
    return last === 'error' || last === 'failed' ? 'failed' : 'scheduled';
  }
  if (last === 'error' || last === 'failed') return 'failed';
  return 'unknown';
}

export function scheduleExpression(job: HermesJob): string {
  const shape = job?.schedule;
  if (typeof shape === 'string') return shape.trim();
  if (!shape || typeof shape !== 'object') return '';
  return word(shape.expr ?? shape.expression);
}

/** Epoch milliseconds, or 0. Numbers below 10^12 are read as seconds. */
export function moment(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value < 1e12 ? value * 1000 : value;
  }
  const text = word(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `12 分钟后`, `3 小时前`, `刚刚`: read at a glance. */
export function distance(at: number, now: number): string {
  if (!at) return '';
  const delta = at - now;
  const size = Math.abs(delta);
  if (size < 45_000) return t("刚刚");
  const minutes = Math.round(size / 60_000);
  let span = t("{0} 分钟", { "0": minutes });
  if (minutes >= 1440) span = t("{0} 天", { "0": Math.round(minutes / 1440) });
  else if (minutes >= 60) span = t("{0} 小时", { "0": Math.round(minutes / 60) });
  return delta > 0 ? t("{0}后", { "0": span }) : t("{0}前", { "0": span });
}

export function nextRunText(schedule: Schedule, now: number): string {
  if (schedule.state === 'paused') return t("已暂停");
  if (!schedule.nextRun) return '';
  return distance(schedule.nextRun, now);
}

export function lastRunText(schedule: Schedule, now: number): string {
  if (!schedule.lastRun) return t("尚未运行");
  const when = distance(schedule.lastRun, now);
  const status = schedule.lastStatus.toLowerCase();
  if (status === 'error' || status === 'failed') {
    return schedule.lastError
      ? t("{0}失败：{1}", { "0": when, "1": schedule.lastError })
      : t("{0}失败", { "0": when });
  }
  if (schedule.lastDeliveryError) {
    return t("{0}已运行，但投递失败：{1}", { "0": when, "1": schedule.lastDeliveryError });
  }
  return t("{0}已运行", { "0": when });
}

export type ScheduleDraft = {
  name: string;
  when: string;
  prompt: string;
  deliver: string;
  repeat: string;
};

/** The bridge's limits, said before a round trip. */
export function draftProblem(draft: ScheduleDraft): string {
  const name = word(draft.name);
  if (!name) return t("请填写任务名称。");
  if (name.length > 200) return t("任务名称不能超过 200 个字符。");
  if (!word(draft.when)) return t("请填写运行时间：cron 表达式、间隔或日期。");
  const prompt = word(draft.prompt);
  if (!prompt) return t("请填写要机器人做什么。");
  if (prompt.length > 5000) return t("任务内容不能超过 5000 个字符。");
  const repeat = word(draft.repeat);
  if (repeat && (!/^\d+$/.test(repeat) || Number(repeat) < 1 || Number(repeat) > 10000)) {
    return t("重复次数必须是 1 到 10000 的整数。");
  }
  return '';
}

export function draftBody(draft: ScheduleDraft): {
  name: string;
  schedule: string;
  prompt: string;
  deliver: string;
  repeat?: number;
} {
  const body: { name: string; schedule: string; prompt: string; deliver: string; repeat?: number } = {
    name: word(draft.name),
    schedule: word(draft.when),
    prompt: word(draft.prompt),
    deliver: word(draft.deliver) || 'local',
  };
  const repeat = word(draft.repeat);
  if (repeat) body.repeat = Number(repeat);
  return body;
}

/**
 * One run of a job. Hermes opens the session `cron_<job>_<YYYYMMDD>_<HHMMSS>`
 * for every agent run, so a run is a session the app reads like any other.
 */
export type ScheduleRun = {
  id: string;
  title: string;
  /** Epoch milliseconds of its last line. */
  at: number;
  messages: number;
};

export function runJobOf(sessionId: string): string {
  const match = /^cron_(.+)_\d{8}_\d{6}$/.exec(word(sessionId));
  return match ? match[1] : '';
}

/** The bridge sends `lastActive` in seconds. */
export function runsByJob(
  sessions: { id?: string; title?: string; lastActive?: number; messageCount?: number }[] | undefined,
): Record<string, ScheduleRun[]> {
  const runs: Record<string, ScheduleRun[]> = {};
  for (const session of sessions ?? []) {
    const id = word(session?.id);
    const job = runJobOf(id);
    if (!job) continue;
    const seconds = Number(session?.lastActive);
    (runs[job] ??= []).push({
      id,
      title: word(session?.title) || t("一次运行"),
      at: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
      messages: Number(session?.messageCount) || 0,
    });
  }
  for (const list of Object.values(runs)) list.sort((left, right) => right.at - left.at);
  return runs;
}

export function deliverText(deliver: string): string {
  const where = word(deliver).toLowerCase();
  if (!where || where === 'local') return t("保留在服务器");
  if (where.startsWith('bot-chat:')) {
    const bot = word(deliver).slice('bot-chat:'.length).trim();
    return t("交给 {0} 的聊天", { "0": bot || t("机器人") });
  }
  return t("投递到 {0}", { "0": word(deliver) });
}

/** Coming runs first (nearest on top), then paused, then broken or finished. */
export function sortSchedules(rows: Schedule[]): Schedule[] {
  const rank: Record<ScheduleState, number> = { scheduled: 0, paused: 1, failed: 2, done: 3, unknown: 4 };
  return [...rows].sort((left, right) => {
    if (rank[left.state] !== rank[right.state]) return rank[left.state] - rank[right.state];
    if (left.state === 'scheduled' && left.nextRun !== right.nextRun) {
      if (!left.nextRun) return 1;
      if (!right.nextRun) return -1;
      return left.nextRun - right.nextRun;
    }
    if (left.state === 'paused' || left.state === 'unknown') return left.name.localeCompare(right.name);
    if (left.lastRun !== right.lastRun) return right.lastRun - left.lastRun;
    return left.name.localeCompare(right.name);
  });
}

/** `{ jobs: [...] }`, read defensively: a row without an id cannot be acted on. */
export function readSchedules(payload: unknown): Schedule[] {
  const raw = Array.isArray(payload)
    ? payload
    : ((payload as { jobs?: unknown } | null)?.jobs ?? (payload as { data?: unknown } | null)?.data);
  if (!Array.isArray(raw)) return [];
  const rows: Schedule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const job = entry as HermesJob;
    const id = word(job.id);
    if (!id) continue;
    const repeat = (job.repeat ?? {}) as { completed?: unknown };
    rows.push({
      id,
      name: scheduleName(job),
      when: scheduleText(job),
      expression: scheduleExpression(job),
      prompt: word(job.prompt),
      state: scheduleState(job),
      nextRun: moment(job.next_run_at),
      lastRun: moment(job.last_run_at),
      lastStatus: word(job.last_status),
      lastError: word(job.last_error),
      lastDeliveryError: word(job.last_delivery_error),
      deliver: word(job.deliver),
      noAgent: Boolean(job.no_agent),
      completed: count(repeat.completed),
    });
  }
  return sortSchedules(rows);
}

/**
 * A stale next-run time warrants checking the scheduler, but does not prove
 * it stopped. Two minutes of slack covers a tick in flight.
 */
export function schedulerStanding(rows: Schedule[], now: number): { late: number; text: string } {
  const late = rows.filter(
    (row) => row.state === 'scheduled' && row.nextRun > 0 && now - row.nextRun > 120_000,
  ).length;
  if (!late) return { late: 0, text: '' };
  return {
    late,
    text:
      late === 1
        ? t("有 1 个任务的下次运行时间已过，请刷新或检查服务器调度器。")
        : t("有 {0} 个任务的下次运行时间已过，请刷新或检查服务器调度器。", { "0": late }),
  };
}

export function emptyText(): string {
  return t("服务器上还没有定时任务");
}
