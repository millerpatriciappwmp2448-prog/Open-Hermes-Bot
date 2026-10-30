/**
 * What the screens show. Nothing here talks to a host: the mobile app is a
 * front-end, and this file is the transcript it draws.
 */

import type { BloubShape } from './bloubFrames';

export type Bot = {
  id: string;
  name: string;
  shape: BloubShape;
  color: string;
  role: string;
  session: string;
};

export type Reaction = { emoji: string; count: number };

export type MessageKind = 'text' | 'voice' | 'attachment';

export type Attachment = { name: string; size: string };

export type Message = {
  id: string;
  /** 'user', or the id of the bot that said it. */
  from: string;
  text: string;
  kind?: MessageKind;
  attachment?: Attachment;
  /** A voice note carries how long it ran. */
  duration?: string;
  reaction?: Reaction;
};

export type Thread = {
  id: string;
  kind: 'bot' | 'group';
  /** The bot, or the first member of a group. */
  botId: string;
  name: string;
  preview: string;
  time: string;
  unread?: boolean;
  threadModel: string;
  /** Kept at the top of the conversation list. */
  pinned?: boolean;
  /** Set while a turn is being written. */
  typing?: boolean;
  /** The Hermes session behind this thread, once there is one. */
  sessionId?: string;
  /** Group only: the bots in the round, in speaking order. */
  members?: string[];
  /** Group only: the line under the name in the header. */
  subtitle?: string;
};

export type Model = { mark: string; name: string; meta?: string; tag?: string };
export type ModelGroup = { group: string; models: Model[] };

export const BOTS: Record<string, Bot> = {
  chief: {
    id: 'chief',
    name: "总助",
    shape: 'cercle',
    color: '#8b5cf6',
    role: "默认",
    session: '0b77',
  },
  atlas: {
    id: 'atlas',
    name: 'Atlas',
    shape: 'capsule',
    color: '#4f9d8f',
    role: "部署",
    session: '4f2a',
  },
  june: {
    id: 'june',
    name: 'June',
    shape: 'nuage',
    color: '#e152b0',
    role: "写作",
    session: '9c1d',
  },
  rook: {
    id: 'rook',
    name: 'Rook',
    shape: 'hexagone',
    color: '#3f6fd1',
    role: "定价",
    session: 'a310',
  },
  sage: {
    id: 'sage',
    name: 'Sage',
    shape: 'galet',
    color: '#e09248',
    role: "研究",
    session: 'c802',
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    shape: 'goutte',
    color: '#2fbfa0',
    role: "笔记",
    session: '1d44',
  },
};

export const PINNED = ['chief', 'atlas', 'june'];

export const CREW = ['atlas', 'june', 'chief'];

export const DEFAULT_MODEL = 'Sonnet 4.5';

export const THREADS: Thread[] = [
  {
    id: 'crew',
    kind: 'group',
    botId: 'atlas',
    name: "团队",
    preview: "Atlas · 第 412 次部署已成功。",
    time: "2分钟前",
    unread: true,
    pinned: true,
    threadModel: DEFAULT_MODEL,
    members: CREW,
    subtitle: "3 个机器人 · 各自独立会话",
  },
  {
    id: 'chief-thread',
    kind: 'bot',
    botId: 'chief',
    name: "总助",
    preview: "本周摘要：三件重要的事。",
    time: '9:41',
    pinned: true,
    threadModel: DEFAULT_MODEL,
  },
  {
    id: 'atlas-thread',
    kind: 'bot',
    botId: 'atlas',
    name: 'Atlas',
    preview: "回滚流程已测试，正在创建 #218。",
    time: '14:02',
    pinned: true,
    threadModel: DEFAULT_MODEL,
  },
  {
    id: 'june-thread',
    kind: 'bot',
    botId: 'june',
    name: 'June',
    preview: "发布说明已起草，共 240 字。",
    time: "周二",
    pinned: true,
    threadModel: DEFAULT_MODEL,
  },
  {
    id: 'rook-thread',
    kind: 'bot',
    botId: 'rook',
    name: 'Rook',
    preview: "定价页面有两种方案。",
    time: "周一",
    threadModel: DEFAULT_MODEL,
  },
  {
    id: 'sage-thread',
    kind: 'bot',
    botId: 'sage',
    name: 'Sage',
    preview: "已保留三个备选方案，检查均已通过。",
    time: "周日",
    threadModel: DEFAULT_MODEL,
  },
  {
    id: 'nova-thread',
    kind: 'bot',
    botId: 'nova',
    name: 'Nova',
    preview: "访谈笔记已保存到资料库。",
    time: "周六",
    threadModel: DEFAULT_MODEL,
  },
];

export const MESSAGES: Record<string, Message[]> = {
  'chief-thread': [
    {
      id: 'c1',
      from: 'chief',
      text: "早上好。我已检查三次发布，一切正常。有两件事需要你关注。",
    },
    { id: 'c2', from: 'user', text: "简短一点，每项修复用一句话说明。" },
    {
      id: 'c3',
      from: 'chief',
      text: "好的。\n\n• 第 412 次部署成功，已测试回滚。\n• 账单回调重试两次后投递成功。\n• 搜索索引已在夜间重建。",
      reaction: { emoji: '👍', count: 1 },
    },
    { id: 'c4', from: 'user', text: "再为手机端界面创建一个 PR。" },
    {
      id: 'c5',
      from: 'chief',
      text: "已创建 #218，仅修改消息输入框，可以先行发布。",
    },
  ],
  crew: [
    {
      id: 'g1',
      from: 'atlas',
      text: "第 412 次部署成功，回滚流程已测试两次。",
      reaction: { emoji: '👍', count: 2 },
    },
    {
      id: 'g2',
      from: 'june',
      text: "发布说明已起草，共 240 字，没有使用感叹号。",
      reaction: { emoji: '🎯', count: 1 },
    },
    {
      id: 'g3',
      from: 'user',
      text: "部署后发布说明。@Atlas 请留意错误。",
    },
    {
      id: 'g4',
      from: 'chief',
      text: "收到。如无变化，我会在 18:00 汇报。",
      reaction: { emoji: '👀', count: 1 },
    },
  ],
  'atlas-thread': [
    {
      id: 'a1',
      from: 'atlas',
      text: "回滚流程已测试。正在创建 #218，包含回滚脚本和两个失败用例。",
    },
    { id: 'a2', from: 'user', text: "好的，这个 PR 就包含这些内容。" },
  ],
  'june-thread': [
    {
      id: 'j1',
      from: 'june',
      text: "发布说明已起草，共 240 字，包含一条测试版反馈，没有感叹号。",
    },
  ],
  'rook-thread': [
    {
      id: 'r1',
      from: 'rook',
      text: "定价页有两种方案：每个档位单独一页，或在同一页切换。切换更直接，独立页面更清晰。",
    },
  ],
  'sage-thread': [
    {
      id: 's1',
      from: 'sage',
      text: "已保留三个备选方案，检查均通过，中间的方案少 40 行代码。",
    },
  ],
  'nova-thread': [
    {
      id: 'n1',
      from: 'nova',
      text: "访谈笔记已保存到资料库：六场访谈，三个主题。",
    },
  ],
};

export const CHAT_EVENTS: Record<string, { event: string; time: string; typing?: boolean }> = {
  crew: { event: "3 个机器人已加入 · 会话相互独立", time: "今天 · 14:04", typing: true },
  'chief-thread': { event: "会话开始于昨天 09:12", time: "今天 · 14:02" },
};

export const MODELS: ModelGroup[] = [
  { group: "已配置", models: [{ mark: 'H', name: "Hermes 默认模型", meta: 'Sonnet 4.5' }] },
  { group: "收藏", models: [{ mark: 'C', name: 'Claude Sonnet 4.5', tag: '当前' }] },
  { group: 'Anthropic', models: [{ mark: 'C', name: 'Claude Opus 4.1', meta: '200k' }] },
  { group: 'OpenAI', models: [{ mark: 'G', name: 'GPT-5.2', meta: '400k' }] },
  { group: 'Google', models: [{ mark: 'G', name: 'Gemini 3 Pro', meta: '1M' }] },
  { group: 'xAI', models: [{ mark: 'X', name: 'Grok 4.1', meta: '256k' }] },
];

/** The eight dots of the create sheet, in the order the mockup draws them. */
export const COLORS = [
  '#4f9d8f',
  '#2fbfa0',
  '#3f6fd1',
  '#5b5bda',
  '#7a5bc2',
  '#e152b0',
  '#e09248',
  '#3ecf8e',
];

export const SHAPES: { id: BloubShape; label: string }[] = [
  { id: 'cercle', label: "圆形" },
  { id: 'galet', label: "鹅卵石" },
  { id: 'squircle', label: "圆角方形" },
  { id: 'capsule', label: "胶囊" },
  { id: 'triangle', label: "三角形" },
  { id: 'hexagone', label: "六边形" },
  { id: 'nuage', label: "云朵" },
  { id: 'goutte', label: "水滴" },
];

/** What the host is: the line under every face, and the settings card. */
export const HOST = {
  name: '',
  version: '1.0.0',
  connection: 'HTTPS',
};

/** The preferences the settings pages edit. Nothing is written to disk. */
export type Prefs = {
  host: string;
  apiPort: string;
  localPort: string;
  sshHost: string;
  defaultModel: string;
  voice: 'host' | 'device';
  autoUpdate: boolean;
  connected: boolean;
};

export const PREFS: Prefs = {
  host: HOST.name,
  apiPort: '8642',
  localPort: '18742',
  sshHost: '',
  defaultModel: DEFAULT_MODEL,
  voice: 'host',
  autoUpdate: true,
  connected: false,
};

/** The canned things the attach sheet can hand over, since nothing is read. */
export const ATTACHMENTS: { kind: string; name: string; size: string }[] = [
  { kind: "照片", name: 'IMG_4821.HEIC', size: '2.4 MB' },
  { kind: "文件", name: 'deploy-notes.md', size: '12 KB' },
  { kind: "相机", name: "照片 · 14:06", size: '1.8 MB' },
];
