export type CodexChat = {
  id: string;
  kind?: string;
  hostId?: string;
  title: string;
  status?: { type: string; activeFlags?: string[] };
  cwd?: string;
  messages?: Array<{ role: string; content: string }>;
};

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
