import { t, useTranslation, localeTag } from './i18n';
import { localizeDemo } from './i18n/demo';
import { modelForTurn, readModelPick, withModelPick, type ModelRef } from './modelSelection';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import {
  BOTS,
  MESSAGES,
  PREFS,
  THREADS,
  DEFAULT_MODEL,
  type Attachment,
  type Bot,
  type Message,
  type MessageKind,
  type Prefs,
  type Thread,
} from './data';
import type { BloubShape } from './bloubFrames';
import {
  BridgeError,
  bridgeHealth,
  bridgePair,
  createBridgeClient,
  normalizeUrl,
  type BridgeBot,
  type BridgeClient,
  type BridgeDevice,
  type BridgeHealth,
  type BridgeModels,
  type BridgeSession,
} from './api';

/**
 * What the app knows while it runs.
 *
 * Two lives, one store. Without a bridge the screens draw the sample the app
 * shipped with. Once a phone is paired, the bots, the conversations and the
 * transcripts come from Hermes — and a message sent here is a real turn. The
 * bridge's address and this phone's token are the only things kept on the
 * device; everything said stays on the host.
 */

export type Toggles = {
  tapbacks: boolean;
  sounds: boolean;
  haptics: boolean;
  notifications: boolean;
};

export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'error';

export type Connection = {
  status: ConnectionStatus;
  /** The bridge's address, as typed and as normalized. */
  url: string;
  device: string;
  error?: string;
  health?: BridgeHealth;
  /** Primary profile's server default, for the connection summary only. */
  model: string;
  provider: string;
};

type NewBot = { name: string; shape: BloubShape; color: string; model: string };
type NewGroup = { name: string; members: string[]; model: string };
type Outgoing = {
  text: string;
  kind?: MessageKind;
  attachment?: Attachment;
  duration?: string;
};

type Store = {
  bots: Bot[];
  threads: Thread[];
  messages: Record<string, Message[]>;
  toggles: Toggles;
  toggle: (key: keyof Toggles) => void;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;

  connection: Connection;
  connect: (url: string, code: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  devices: BridgeDevice[];
  revokeDevice: (id: string) => Promise<void>;
  modelOptions: Record<string, BridgeModels>;
  modelPicks: Record<string, ModelRef>;
  refreshModels: (botId: string) => Promise<void>;
  selectModel: (botId: string, model: ModelRef | null) => Promise<void>;

  botById: (id: string) => Bot | undefined;
  threadById: (id: string) => Thread | undefined;

  addBot: (input: NewBot) => string;
  updateBot: (id: string, patch: Partial<Pick<Bot, 'name' | 'shape' | 'color'>>) => void;
  removeBot: (id: string) => void;

  addGroup: (input: NewGroup) => string;
  updateGroup: (id: string, patch: Partial<Pick<Thread, 'name' | 'members'>>) => void;
  leaveGroup: (id: string) => void;

  setModel: (threadId: string, model: string) => void;
  togglePin: (threadId: string) => void;
  markRead: (threadId: string) => void;
  markUnread: (threadId: string) => void;
  removeThread: (threadId: string) => void;
  clearThread: (threadId: string) => void;

  send: (threadId: string, payload: Outgoing) => void;
  react: (threadId: string, messageId: string, emoji: string) => void;
  removeMessage: (threadId: string, messageId: string) => void;
};

const StoreContext = createContext<Store | null>(null);

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'bot'
  );
}

function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let index = 2;
  while (taken.includes(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function relativeTime(epoch: number): string {
  if (!epoch) return '';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  if (seconds < 60) return t("刚刚");
  if (seconds < 3600) return t("{0}分钟前", {"0": Math.floor(seconds / 60)});
  if (seconds < 86400) return t("{0}小时前", {"0": Math.floor(seconds / 3600)});
  const date = new Date(epoch * 1000);
  if (seconds < 7 * 86400) {
    return [t("周日"), t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六")][date.getDay()];
  }
  return date.toLocaleDateString(localeTag(), { month: 'short', day: 'numeric' });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  }
}

/* ------------------------------------------------------------- the token */

const KEEP = 'hermes.bridge';

type Saved = { url: string; token: string; device: string };

let keychain: typeof import('expo-secure-store') | null = null;
try {
  // SecureStore is the Keychain on iOS. The browser has none of it, so the
  // token lives in memory there — and a reload asks for the code again.
  keychain = require('expo-secure-store');
} catch {
  keychain = null;
}

async function readSaved(): Promise<Saved | null> {
  if (!keychain) return null;
  try {
    const raw = await keychain.getItemAsync(KEEP);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.url || !parsed?.token) return null;
    return { url: String(parsed.url), token: String(parsed.token), device: String(parsed.device || '') };
  } catch {
    return null;
  }
}

async function writeSaved(value: Saved | null): Promise<void> {
  if (!keychain) return;
  try {
    if (value) await keychain.setItemAsync(KEEP, JSON.stringify(value));
    else await keychain.deleteItemAsync(KEEP);
  } catch {
    // The Keychain refused: the session works, it just will not survive a
    // restart.
  }
}

/* ------------------------------------------------------------ the shapes */

function toBot(raw: BridgeBot): Bot {
  return {
    id: raw.id,
    name: raw.name,
    shape: (raw.shape || 'cercle') as BloubShape,
    color: raw.color || '#8b5cf6',
    role: raw.primary ? t("默认") : 'Hermes',
    session: raw.profile === 'default' ? '' : raw.profile.slice(0, 4),
  };
}

function toMessages(threadId: string, botId: string, rows: { role: string; content: string }[]): Message[] {
  const out: Message[] = [];
  rows.forEach((row, index) => {
    if (row.role !== 'user' && row.role !== 'assistant') return;
    if (!row.content) return;
    out.push({
      id: `${threadId}:${index}`,
      from: row.role === 'user' ? 'user' : botId,
      text: row.content,
    });
  });
  return out;
}

function previewOf(rows: Message[], fallback: string): string {
  const last = [...rows].reverse().find((message) => message.text.trim());
  if (!last) return fallback;
  return last.text.replace(/\s+/g, ' ').trim().slice(0, 90);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { language } = useTranslation();
  const demo = useRef({
    bots: Object.values(BOTS),
    threads: THREADS,
    messages: MESSAGES,
  });

  const [bots, setBots] = useState<Bot[]>(demo.current.bots);
  const [threads, setThreads] = useState<Thread[]>(demo.current.threads);
  const [messages, setMessages] = useState<Record<string, Message[]>>(demo.current.messages);
  const [prefs, setPrefs] = useState<Prefs>(PREFS);
  const [toggles, setToggles] = useState<Toggles>({
    tapbacks: true,
    sounds: true,
    haptics: true,
    notifications: true,
  });
  const [connection, setConnection] = useState<Connection>({
    status: 'offline',
    url: '',
    device: '',
    model: '',
    provider: '',
  });
  const [devices, setDevices] = useState<BridgeDevice[]>([]);
  const [modelOptions, setModelOptions] = useState<Record<string, BridgeModels>>({});
  const [modelPicks, setModelPicks] = useState<Record<string, ModelRef>>({});
  const optionsRef = useRef(modelOptions);
  const picksRef = useRef(modelPicks);
  const profilesRef = useRef<Record<string, string>>({});
  const modelWrites = useRef<Promise<unknown>>(Promise.resolve());

  const client = useRef<BridgeClient | null>(null);
  const threadsRef = useRef<Thread[]>(threads);
  const connectionRef = useRef(connection);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const toggle = useCallback((key: keyof Toggles) => {
    setToggles((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((current) => ({ ...current, [key]: value }));
  }, []);

  const display = useMemo(() => {
    const view = { bots, threads, messages };
    return client.current ? view : localizeDemo(view, demo.current, t);
  }, [bots, threads, messages, language, connection.status]);

  const botById = useCallback((id: string) => display.bots.find((bot) => bot.id === id), [display.bots]);
  const threadById = useCallback(
    (id: string) => display.threads.find((thread) => thread.id === id),
    [display.threads],
  );

  /* --------------------------------------------------------- the bridge */

  const adopt = useCallback(async (url: string, token: string, device: string) => {
    const bridge = createBridgeClient(url, token);
    const [rawBots, sessions, savedPrefs] = await Promise.all([bridge.bots(), bridge.sessions(), bridge.prefs()]);

    const newest = (botId: string): BridgeSession | undefined =>
      sessions
        .filter((row) => row.bot === botId && !row.archived)
        .sort((left, right) => right.lastActive - left.lastActive)[0];

    const loaded = await Promise.all(
      rawBots.map(async (raw) => {
        const latest = newest(raw.id);
        const [rows, options] = await Promise.all([
          latest ? bridge.messages(raw.id, latest.id, 80).catch(() => []) : Promise.resolve([]),
          bridge.models(raw.id).catch(() => undefined),
        ]);
        const pick = readModelPick(savedPrefs, raw.profile || 'default');
        return { raw, latest, rows, options, pick };
      }),
    );

    const nextBots = loaded.map((entry) => toBot(entry.raw));
    const nextThreads: Thread[] = loaded.map((entry) => {
      const threadId = `bot:${entry.raw.id}`;
      const rows = toMessages(threadId, entry.raw.id, entry.rows);
      return {
        id: threadId,
        kind: 'bot',
        botId: entry.raw.id,
        name: entry.raw.name,
        preview: previewOf(
          rows,
          entry.latest ? t("{0} 条消息", {"0": entry.latest.messageCount}) : t("暂无会话"),
        ),
        time: entry.latest ? relativeTime(entry.latest.lastActive) : '',
        threadModel: entry.pick?.model || entry.options?.current || '',
        sessionId: entry.latest?.id,
        unread: false,
      };
    });
    const nextMessages: Record<string, Message[]> = {};
    loaded.forEach((entry) => {
      nextMessages[`bot:${entry.raw.id}`] = toMessages(
        `bot:${entry.raw.id}`,
        entry.raw.id,
        entry.rows,
      );
    });

    const nextOptions: Record<string, BridgeModels> = {};
    const nextPicks: Record<string, ModelRef> = {};
    const profiles: Record<string, string> = {};
    loaded.forEach(({ raw, options, pick }) => {
      profiles[raw.id] = raw.profile || 'default';
      if (options) nextOptions[raw.id] = options;
      if (pick) nextPicks[raw.id] = pick;
    });
    const primary = loaded.find(entry => entry.raw.primary);
    const model = primary?.options?.current || '';
    const provider = primary?.options?.currentProvider || '';

    let health: BridgeHealth | undefined;
    try {
      health = await bridge.health();
    } catch {
      health = undefined;
    }

    client.current = bridge;
    profilesRef.current = profiles;
    optionsRef.current = nextOptions;
    picksRef.current = nextPicks;
    setModelOptions(nextOptions);
    setModelPicks(nextPicks);
    setBots(nextBots);
    setThreads(nextThreads);
    setMessages(nextMessages);
    setConnection({ status: 'connected', url, device, health, model, provider });
    setPrefs((current) => ({
      ...current,
      host: hostOf(url),
      connected: true,
    }));
    try {
      setDevices(await bridge.devices());
    } catch {
      setDevices([]);
    }
  }, []);

  const refreshModels = useCallback(async (botId: string) => {
    const active = client.current;
    if (!active) throw new BridgeError(t('请先连接服务器。'));
    const options = await active.models(botId);
    if (client.current !== active) return;
    optionsRef.current = { ...optionsRef.current, [botId]: options };
    setModelOptions(optionsRef.current);
    setThreads(current => current.map(thread => thread.botId === botId
      ? { ...thread, threadModel: picksRef.current[botId]?.model || options.current } : thread));
  }, []);

  const selectModel = useCallback(async (botId: string, pick: ModelRef | null) => {
    const active = client.current;
    const profile = profilesRef.current[botId];
    if (!active || profile === undefined) throw new BridgeError(t('请先连接服务器。'));
    // Serialize edits, read a fresh snapshot and preserve every unrelated desktop preference.
    const write = modelWrites.current.catch(() => undefined).then(async () => {
      if (client.current !== active) throw new BridgeError(t('连接已改变，请重新选择模型。'));
      const saved = await active.prefs();
      if (client.current !== active) throw new BridgeError(t('连接已改变，请重新选择模型。'));
      await active.savePrefs(withModelPick(saved, profile, pick));
      if (client.current !== active) throw new BridgeError(t('连接已改变，请重新选择模型。'));
      const next = { ...picksRef.current };
      if (pick) next[botId] = pick;
      else delete next[botId];
      picksRef.current = next;
      setModelPicks(next);
      setThreads(current => current.map(thread => thread.botId === botId
        ? { ...thread, threadModel: pick?.model || optionsRef.current[botId]?.current || '' } : thread));
    });
    modelWrites.current = write;
    await write;
  }, []);

  const refresh = useCallback(async () => {
    const active = client.current;
    const current = connectionRef.current;
    if (!active) return;
    try {
      await adopt(current.url, active.token, current.device);
    } catch (error) {
      const message =
        error instanceof BridgeError ? error.message : t("无法从桥接服务读取数据。");
      setConnection((state) => ({ ...state, status: 'error', error: message }));
    }
  }, [adopt]);

  const connect = useCallback(
    async (rawUrl: string, code: string) => {
      const url = normalizeUrl(rawUrl);
      if (!url) throw new BridgeError(t("请先填写桥接服务的 HTTPS 地址。"), 'no_url');
      if (!code.trim()) throw new BridgeError(t("请填写在服务器上生成的配对码。"), 'no_code');
      setConnection((state) => ({ ...state, status: 'connecting', url, error: undefined }));

      try {
        const health = await bridgeHealth(url);
        if (!health.ok) {
          throw new BridgeError(t("桥接服务已运行，但 Hermes 未响应。"), 'no_hermes');
        }

        const deviceName =
          Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : t("当前浏览器");
        const paired = await bridgePair(url, code, deviceName);

        client.current = createBridgeClient(url, paired.token);
        await adopt(url, paired.token, paired.device.name);
        await writeSaved({ url, token: paired.token, device: paired.device.name });
      } catch (error) {
        const message =
          error instanceof BridgeError
            ? error.message
            : t("无法连接桥接服务，请检查地址、Tailscale 和服务器状态。");
        setConnection((state) => ({ ...state, status: 'error', error: message, url }));
        throw error;
      }
    },
    [adopt],
  );

  const disconnect = useCallback(async () => {
    client.current = null;
    await writeSaved(null);
    setConnection({ status: 'offline', url: '', device: '', model: '', provider: '' });
    setDevices([]);
    profilesRef.current = {};
    optionsRef.current = {};
    picksRef.current = {};
    setModelOptions({});
    setModelPicks({});
    setBots(demo.current.bots);
    setThreads(demo.current.threads);
    setMessages(demo.current.messages);
    setPrefs((current) => ({ ...current, connected: false, host: PREFS.host }));
  }, []);

  const revokeDevice = useCallback(async (id: string) => {
    const active = client.current;
    if (!active) return;
    await active.revokeDevice(id);
    setDevices((current) => current.filter((device) => device.id !== id));
  }, []);

  // A phone that was paired once should not ask again at every launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await readSaved();
      if (!saved || cancelled) return;
      setConnection((state) => ({ ...state, status: 'connecting', url: saved.url, device: saved.device }));
      try {
        await adopt(saved.url, saved.token, saved.device);
      } catch (error) {
        if (cancelled) return;
        setConnection({
          status: 'error',
          url: saved.url,
          device: saved.device,
          model: '',
          provider: '',
          error:
            error instanceof BridgeError
              ? error.message
              : t("桥接服务未响应，请检查 Tailscale 是否已连接。"),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  /* ----------------------------------------------------------- the bots */

  const addBot = useCallback<Store['addBot']>(
    ({ name, shape, color, model }) => {
      const label = name.trim() || t("新机器人");
      const online = connectionRef.current.status === 'connected';
      const taken = bots.map((bot) => bot.id);
      const id = uniqueId(slug(label), taken);
      const bot: Bot = {
        id: online ? slug(label) : id,
        name: label,
        shape,
        color,
        role: online ? 'Hermes' : t("新建"),
        session: Math.random().toString(16).slice(2, 6),
      };
      setBots((current) => [...current, bot]);
      const threadId = online ? `bot:${bot.id}` : `${id}-thread`;
      setThreads((current) => [
        {
          id: threadId,
          kind: 'bot',
          botId: bot.id,
          name: label,
          preview: online ? t("正在服务器上创建…") : t("已创建演示机器人。"),
          time: t("刚刚"),
          threadModel: online ? '' : model,
        },
        ...current,
      ]);
      setMessages((current) => ({ ...current, [threadId]: [] }));

      if (online && client.current) {
        const active = client.current;
        void active
          .createBot({ name: slug(label), title: label, color, shape })
          .then(async (created) => {
            if (client.current !== active) return;
            profilesRef.current[created.id] = created.profile || 'default';
            const options = await active.models(created.id).catch(() => undefined);
            if (client.current !== active) return;
            if (options) {
              optionsRef.current = { ...optionsRef.current, [created.id]: options };
              setModelOptions(optionsRef.current);
            }
            setBots((current) =>
              current.map((entry) => (entry.id === bot.id ? toBot(created) : entry)),
            );
            setThreads((current) =>
              current.map((entry) =>
                entry.id === threadId ? { ...entry, preview: t("暂无会话"), threadModel: options?.current || '' } : entry,
              ),
            );
          })
          .catch((error: unknown) => {
            const message =
              error instanceof BridgeError ? error.message : t("无法创建机器人。");
            setThreads((current) =>
              current.map((entry) =>
                entry.id === threadId ? { ...entry, preview: `⚠︎ ${message}` } : entry,
              ),
            );
          });
      }
      return threadId;
    },
    [bots],
  );

  const updateBot = useCallback<Store['updateBot']>(
    (id, patch) => {
      setBots((current) => current.map((bot) => (bot.id === id ? { ...bot, ...patch } : bot)));
      if (patch.name) {
        setThreads((current) =>
          current.map((thread) =>
            thread.kind === 'bot' && thread.botId === id ? { ...thread, name: patch.name! } : thread,
          ),
        );
      }
      if (connectionRef.current.status === 'connected' && client.current) {
        void client.current
          .updateBot(id, {
            ...(patch.name ? { title: patch.name } : {}),
            ...(patch.color ? { color: patch.color } : {}),
            ...(patch.shape ? { shape: patch.shape } : {}),
          })
          .catch(() => undefined);
      }
    },
    [],
  );

  const removeBot = useCallback<Store['removeBot']>(
    (id) => {
      setBots((current) => current.filter((bot) => bot.id !== id));
      setThreads((current) =>
        current
          .filter((thread) => !(thread.kind === 'bot' && thread.botId === id))
          .map((thread) =>
            thread.kind === 'group' && thread.members
              ? { ...thread, members: thread.members.filter((member) => member !== id) }
              : thread,
          )
          // A group of one is not a group: the last two bots are the round.
          .filter((thread) => thread.kind !== 'group' || (thread.members?.length ?? 0) >= 2),
      );
      setMessages((current) => {
        const next: Record<string, Message[]> = {};
        for (const [key, value] of Object.entries(current)) {
          if (key !== `${id}-thread` && key !== `bot:${id}`) next[key] = value;
        }
        return next;
      });
      if (connectionRef.current.status === 'connected' && client.current) {
        void client.current.deleteBot(id).catch(() => undefined);
      }
    },
    [],
  );

  /* ----------------------------------------------------------- the groups */

  const addGroup = useCallback<Store['addGroup']>(
    ({ name, members, model }) => {
      const label = name.trim() || t("团队");
      const id = uniqueId(
        `${slug(label)}-group`,
        threads.map((thread) => thread.id),
      );
      const first = bots.find((bot) => bot.id === members[0]);
      const online = connectionRef.current.status === 'connected';
      setThreads((current) => [
        {
          id,
          kind: 'group',
          botId: members[0] ?? '',
          name: label,
          preview: online
            ? t("群组功能尚未接入 Hermes。")
            : t("{0} · 已创建演示群组。", {"0": first?.name ?? t("机器人")}),
          time: t("刚刚"),
          threadModel: model,
          members,
          subtitle: t("{0} 个机器人 · 各自独立会话", {"0": members.length}),
        },
        ...current,
      ]);
      setMessages((current) => ({ ...current, [id]: [] }));
      return id;
    },
    [bots, threads],
  );

  const updateGroup = useCallback<Store['updateGroup']>((id, patch) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === id
          ? {
              ...thread,
              ...patch,
              subtitle:
                patch.members && patch.members.length > 0
                  ? t("{0} 个机器人 · 各自独立会话", {"0": patch.members.length})
                  : thread.subtitle,
            }
          : thread,
      ),
    );
  }, []);

  const leaveGroup = useCallback<Store['leaveGroup']>((id) => {
    setThreads((current) => current.filter((thread) => thread.id !== id));
    setMessages((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  /* -------------------------------------------------------- the threads */

  const patchThread = useCallback((id: string, patch: Partial<Thread>) => {
    setThreads((current) =>
      current.map((thread) => (thread.id === id ? { ...thread, ...patch } : thread)),
    );
  }, []);

  const setModel = useCallback<Store['setModel']>(
    (threadId, model) => patchThread(threadId, { threadModel: model }),
    [patchThread],
  );

  const togglePin = useCallback<Store['togglePin']>((threadId) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, pinned: !thread.pinned } : thread,
      ),
    );
  }, []);

  const markRead = useCallback<Store['markRead']>(
    (threadId) => patchThread(threadId, { unread: false }),
    [patchThread],
  );

  const markUnread = useCallback<Store['markUnread']>(
    (threadId) => patchThread(threadId, { unread: true }),
    [patchThread],
  );

  const removeThread = useCallback<Store['removeThread']>((threadId) => {
    const thread = threadsRef.current.find((entry) => entry.id === threadId);
    setThreads((current) => current.filter((entry) => entry.id !== threadId));
    setMessages((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    if (
      thread?.sessionId &&
      connectionRef.current.status === 'connected' &&
      client.current
    ) {
      void client.current.deleteSession(thread.botId, thread.sessionId).catch(() => undefined);
    }
  }, []);

  const clearThread = useCallback<Store['clearThread']>((threadId) => {
    setMessages((current) => ({ ...current, [threadId]: [] }));
  }, []);

  /* ------------------------------------------------------- the messages */

  const send = useCallback<Store['send']>(
    (threadId, payload) => {
      const body = payload.text.trim();
      if (!body) return;
      const thread = threadsRef.current.find((entry) => entry.id === threadId);
      const online =
        connectionRef.current.status === 'connected' && client.current !== null;
      const userMessage: Message = {
        id: `m-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        from: 'user',
        text: body,
        kind: payload.kind ?? 'text',
        attachment: payload.attachment,
        duration: payload.duration,
      };
      setMessages((current) => ({
        ...current,
        [threadId]: [...(current[threadId] ?? []), userMessage],
      }));
      patchThread(threadId, { preview: body, unread: false, time: t("刚刚") });

      if (!online || !thread || thread.kind !== 'bot') {
        if (online && thread?.kind === 'group') {
          patchThread(threadId, { preview: t("群组功能尚未接入 Hermes。") });
        }
        return;
      }
      if (payload.kind === 'attachment' || payload.kind === 'voice') {
        // The bridge takes both; this app does not send the bytes yet.
        patchThread(threadId, { preview: t("附件和语音暂不支持发送到桥接服务。") });
        return;
      }

      const active = client.current;
      if (!active) return;
      const botId = thread.botId;
      const assistantId = `a-${Date.now()}`;
      let answer = '';
      let settled = false;

      const settle = (text: string, failed: boolean) => {
        if (settled) return;
        settled = true;
        setMessages((current) => ({
          ...current,
          [threadId]: (current[threadId] ?? []).map((message) =>
            message.id === assistantId
              ? { ...message, text: failed ? `⚠︎ ${text}` : text }
              : message,
          ),
        }));
        patchThread(threadId, {
          typing: false,
          preview: failed ? text : text.replace(/\s+/g, ' ').slice(0, 90),
          time: t("刚刚"),
        });
      };

      patchThread(threadId, { typing: true });
      setMessages((current) => ({
        ...current,
        [threadId]: [
          ...(current[threadId] ?? []),
          { id: assistantId, from: botId, text: '' },
        ],
      }));

      void (async () => {
        try {
          let sessionId = thread.sessionId;
          if (!sessionId) {
            const created = await active.createSession(botId, thread.name);
            sessionId = created.id;
            patchThread(threadId, { sessionId });
          }
          // Resolve this profile, never the primary profile's model or a demo label.
          // Refresh server defaults before a turn so external config changes take effect.
          if (!picksRef.current[botId]) {
            try {
              const options = await active.models(botId);
              if (client.current !== active) return;
              optionsRef.current = { ...optionsRef.current, [botId]: options };
              setModelOptions(optionsRef.current);
              patchThread(threadId, { threadModel: optionsRef.current[botId].current });
            } catch {
              const next = { ...optionsRef.current };
              delete next[botId];
              optionsRef.current = next;
              setModelOptions(next);
              patchThread(threadId, { threadModel: '' });
            }
          }
          active.turn(
            {
              bot: botId,
              session: sessionId,
              message: body,
              ...modelForTurn(picksRef.current[botId], optionsRef.current[botId]),
            },
            {
              onDelta: (delta) => {
                answer += delta;
                setMessages((current) => ({
                  ...current,
                  [threadId]: (current[threadId] ?? []).map((message) =>
                    message.id === assistantId ? { ...message, text: answer } : message,
                  ),
                }));
              },
              onDone: (text) => settle(text || answer, false),
              onError: (message) => settle(message, true),
            },
          );
        } catch (error) {
          settle(
            error instanceof BridgeError ? error.message : t("无法连接机器人。"),
            true,
          );
        }
      })();
    },
    [patchThread],
  );

  const react = useCallback<Store['react']>((threadId, messageId, emoji) => {
    setMessages((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).map((message) => {
        if (message.id !== messageId) return message;
        if (message.reaction?.emoji === emoji) return { ...message, reaction: undefined };
        return { ...message, reaction: { emoji, count: 1 } };
      }),
    }));
  }, []);

  const removeMessage = useCallback<Store['removeMessage']>((threadId, messageId) => {
    setMessages((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).filter((message) => message.id !== messageId),
    }));
  }, []);

  const value = useMemo<Store>(
    () => ({
      bots: display.bots,
      threads: display.threads,
      messages: display.messages,
      toggles,
      toggle,
      prefs,
      setPref,
      connection,
      connect,
      disconnect,
      refresh,
      devices,
      revokeDevice,
      modelOptions,
      modelPicks,
      refreshModels,
      selectModel,
      botById,
      threadById,
      addBot,
      updateBot,
      removeBot,
      addGroup,
      updateGroup,
      leaveGroup,
      setModel,
      togglePin,
      markRead,
      markUnread,
      removeThread,
      clearThread,
      send,
      react,
      removeMessage,
    }),
    [
      display,
      addBot,
      addGroup,
      botById,
      bots,
      clearThread,
      connect,
      connection,
      devices,
      disconnect,
      leaveGroup,
      markRead,
      markUnread,
      messages,
      prefs,
      react,
      refresh,
      removeBot,
      removeMessage,
      removeThread,
      send,
      setModel,
      setPref,
      threadById,
      threads,
      toggle,
      togglePin,
      toggles,
      updateBot,
      updateGroup,
      revokeDevice,
      modelOptions,
      modelPicks,
      refreshModels,
      selectModel,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}

export { DEFAULT_MODEL };
