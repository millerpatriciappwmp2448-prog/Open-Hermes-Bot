import { t } from './i18n';

/** The phone talks to the bridge; Hermes keys and conversations stay on the host. */
export type BridgeHealth = {
  ok: boolean;
  service: string;
  version: string;
  hermes: { ok: boolean; url: string; primaryKey: boolean };
  pairing: { required: boolean; pending: boolean; expiresAt: number };
};

export type BridgeBot = {
  id: string;
  profile: string;
  name: string;
  title: string;
  description: string;
  color: string;
  shape: string;
  primary: boolean;
  hasKey: boolean;
};

export type BridgeSession = {
  bot: string;
  id: string;
  title: string;
  messageCount: number;
  lastActive: number;
  archived: boolean;
};

export type BridgeMessage = { role: string; content: string; timestamp: number };

export type BridgeDevice = {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
};

export type BridgeModels = {
  current: string;
  currentProvider: string;
  providers: { slug: string; name: string; models: { id: string; name: string }[] }[];
};

/** A failure the bridge already wrote as a sentence, with a code to branch on. */
export class BridgeError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = 'error', status = 0) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

// Translate stable bridge codes; keep unknown upstream details available.
const BRIDGE_ERRORS: Readonly<Record<string, string>> = {
  bad_code: '配对码错误或已过期，请在服务器上重新生成。',
  too_many: '尝试次数过多，请等待几分钟后重试。',
  unauthorized: '本机尚未授权或授权已撤销，请重新配对。',
  no_key: '服务器尚未配置此机器人的 API_SERVER_KEY，请在服务器上配置并重启 Hermes。',
  bad_key: '服务器的 API_SERVER_KEY 与 Hermes 网关不匹配，请检查服务器配置。',
  unreachable: '桥接服务无法连接 Hermes，请检查服务器上的 Hermes 网关和 API 服务。',
  no_bot: '找不到该机器人，请刷新服务器数据。',
  no_session: 'Hermes 未返回会话编号，请检查服务器日志。',
  no_device: '找不到该配对设备，请刷新设备列表。',
  no_title: '请输入会话名称。',
  empty_message: '请先输入消息内容。',
  empty: '发送内容为空。',
  too_large: '发送内容过大，请缩小后重试。',
  bad_json: '请求格式错误，请检查应用与桥接服务的版本。',
  bad_length: '请求长度无效，请重试。',
  bad_prefs: '设置格式无效，请重试。',
  not_found: '桥接服务不支持此接口，请检查地址和服务版本。',
  internal: '桥接服务发生内部错误，请查看服务器日志。',
  bad_name: '配置名称格式无效，请使用小写英文字母、数字或连字符。',
  reserved_name: '该名称由 Hermes 保留，请换一个名称。',
  exists: '该机器人已存在，请换一个名称。',
  bad_color: '不支持此颜色，请重新选择。',
  bad_shape: '不支持此外观形状，请重新选择。',
  primary: '主机器人是 Hermes 本身，无法删除。',
  timeout: 'Hermes 回复超时，请稍后重试。',
  silent: 'Hermes 长时间没有返回数据，请检查服务器状态。',
};

function bridgeErrorMessage(code: string, fallback: string): string {
  if (Object.hasOwn(BRIDGE_ERRORS, code)) return t(BRIDGE_ERRORS[code]);
  if (code === 'hermes_error' || code === 'turn_failed') {
    return t("Hermes 执行失败：{0}", {"0": fallback});
  }
  return fallback;
}

async function readError(response: Response, fallback: string): Promise<BridgeError> {
  let code = 'error';
  let message = fallback;
  try {
    const body = await response.json();
    if (body?.error?.message) {
      message = String(body.error.message);
      code = String(body.error.code || code);
    }
  } catch {
    // A proxy, a tailnet error page: the status is all we have.
  }
  return new BridgeError(bridgeErrorMessage(code, message), code, response.status);
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await run(controller.signal);
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new BridgeError(
        t("连接超时，请检查 Tailscale 和服务器是否正常运行。"),
        'timeout',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The public probe, before any token exists. */
export function bridgeHealth(baseUrl: string): Promise<BridgeHealth> {
  const root = normalizeUrl(baseUrl);
  return withTimeout(async (signal) => {
    let response: Response;
    try {
      response = await fetch(`${root}/v1/health`, { signal, headers: { Accept: 'application/json' } });
    } catch {
      throw new BridgeError(
        t("该地址无响应，请确认手机与服务器位于同一 Tailscale 网络，且桥接服务已启动。"),
        'unreachable',
      );
    }
    if (!response.ok) throw await readError(response, t("桥接服务返回 HTTP {0}", {"0": response.status}));
    return (await response.json()) as BridgeHealth;
  }, 15000);
}

/** The code is worth a token; the token is worth a device. */
export async function bridgePair(
  baseUrl: string,
  code: string,
  deviceName: string,
): Promise<{ token: string; device: BridgeDevice }> {
  const root = normalizeUrl(baseUrl);
  return withTimeout(async (signal) => {
    const response = await fetch(`${root}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase(), name: deviceName }),
      signal,
    });
    if (!response.ok) throw await readError(response, t("配对码被拒绝，请在服务器重新生成配对码。"));
    const body = await response.json();
    return { token: String(body.token), device: body.device as BridgeDevice };
  }, 20000);
}

export type TurnHandlers = {
  onDelta?: (text: string) => void;
  onTool?: (tool: string) => void;
  onDone?: (text: string) => void;
  onError?: (message: string, code?: string) => void;
};

export type BridgeClient = ReturnType<typeof createBridgeClient>;

export function createBridgeClient(rawBase: string, token: string) {
  const root = normalizeUrl(rawBase);
  const auth = { Authorization: `Bearer ${token}` };

  async function request<T>(path: string, init: RequestInit = {}, timeout = 30000): Promise<T> {
    return withTimeout(async (signal) => {
      let response: Response;
      try {
        response = await fetch(`${root}${path}`, {
          ...init,
          signal,
          headers: { Accept: 'application/json', ...auth, ...(init.headers ?? {}) },
        });
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError(t("桥接服务未响应。"), 'unreachable');
      }
      if (!response.ok) throw await readError(response, t("桥接服务返回 HTTP {0}", {"0": response.status}));
      if (response.status === 204) return {} as T;
      return (await response.json()) as T;
    }, timeout);
  }

  const bot = (id: string) => encodeURIComponent(id);
  const session = (id: string) => encodeURIComponent(id);

  return {
    baseUrl: root,
    token,

    health: () => bridgeHealth(root),

    bots: async (): Promise<BridgeBot[]> => (await request<{ bots: BridgeBot[] }>('/v1/bots')).bots,

    sessions: async (): Promise<BridgeSession[]> =>
      (await request<{ sessions: BridgeSession[] }>('/v1/sessions')).sessions,

    messages: async (botId: string, sessionId: string, limit = 200): Promise<BridgeMessage[]> =>
      (
        await request<{ messages: BridgeMessage[] }>(
          `/v1/sessions/${bot(botId)}/${session(sessionId)}/messages?limit=${limit}`,
        )
      ).messages,

    createSession: async (botId: string, title: string): Promise<BridgeSession> =>
      (
        await request<{ session: BridgeSession }>('/v1/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot: botId, title }),
        })
      ).session,

    renameSession: (botId: string, sessionId: string, title: string) =>
      request<{ ok: boolean }>(`/v1/sessions/${bot(botId)}/${session(sessionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }),

    deleteSession: (botId: string, sessionId: string) =>
      request<{ ok: boolean }>(`/v1/sessions/${bot(botId)}/${session(sessionId)}`, {
        method: 'DELETE',
      }),

    models: async (botId: string): Promise<BridgeModels> =>
      (await request<{ models: BridgeModels }>(`/v1/models?bot=${bot(botId)}`)).models,

    createBot: async (input: {
      name: string;
      title: string;
      color: string;
      shape: string;
      description?: string;
    }): Promise<BridgeBot> =>
      (
        await request<{ bot: BridgeBot }>('/v1/bots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }, 60000)
      ).bot,

    updateBot: async (
      botId: string,
      patch: Partial<Pick<BridgeBot, 'title' | 'color' | 'shape' | 'description'>>,
    ): Promise<BridgeBot> =>
      (
        await request<{ bot: BridgeBot }>(`/v1/bots/${bot(botId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      ).bot,

    deleteBot: (botId: string) =>
      request<{ ok: boolean }>(`/v1/bots/${bot(botId)}`, { method: 'DELETE' }, 45000),

    devices: async (): Promise<BridgeDevice[]> =>
      (await request<{ devices: BridgeDevice[] }>('/v1/devices')).devices,

    revokeDevice: async (deviceId: string): Promise<void> => {
      await request<{ ok: boolean }>(`/v1/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
      });
    },

    prefs: async (): Promise<Record<string, unknown>> =>
      (await request<{ prefs: Record<string, unknown> }>('/v1/prefs')).prefs,

    savePrefs: (prefs: Record<string, unknown>) =>
      request<{ prefs: Record<string, unknown> }>('/v1/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs }),
      }),

    /**
     * One turn. Streams over XHR because a phone's fetch does not hand out a
     * readable body; `onprogress` is the one stream both iOS and the web give.
     */
    turn(
      input: { bot: string; session: string; message: string; model?: string; provider?: string },
      handlers: TurnHandlers,
    ): () => void {
      const xhr = new XMLHttpRequest();
      let seen = 0;
      let buffer = '';
      let finished = false;

      const close = () => {
        try {
          xhr.abort();
        } catch {
          // Already closed.
        }
      };

      const emit = (frame: string) => {
        let event = 'message';
        const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trim());
        }
        if (!data.length) return;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(data.join('\n'));
        } catch {
          payload = { text: data.join('\n') };
        }
        if (event === 'delta') handlers.onDelta?.(String(payload.text ?? ''));
        else if (event === 'tool') handlers.onTool?.(String(payload.tool ?? ''));
        else if (event === 'done') {
          finished = true;
          handlers.onDone?.(String(payload.text ?? ''));
        } else if (event === 'error') {
          finished = true;
          handlers.onError?.(
            bridgeErrorMessage(String(payload.code ?? ''), String(payload.message ?? t("机器人在回复前停止了运行。"))),
            payload.code ? String(payload.code) : undefined,
          );
        }
      };

      xhr.open('POST', `${root}/v1/sessions/${bot(input.bot)}/${session(input.session)}/turns`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.timeout = 5 * 60 * 1000;

      xhr.onprogress = () => {
        const text = xhr.responseText ?? '';
        if (text.length <= seen) return;
        buffer += text.slice(seen);
        seen = text.length;
        let split = buffer.indexOf('\n\n');
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf('\n\n');
          if (frame.trim()) emit(frame);
        }
      };

      xhr.onerror = () => {
        if (finished) return;
        finished = true;
        handlers.onError?.(t("与桥接服务的连接已断开。"), 'network');
      };

      xhr.ontimeout = () => {
        if (finished) return;
        finished = true;
        handlers.onError?.(t("机器人回复超时，已等待超过五分钟。"), 'timeout');
      };

      xhr.onload = () => {
        if (finished) return;
        if (xhr.status >= 400) {
          let message = t("桥接服务返回 HTTP {0}", {"0": xhr.status});
          let code = 'error';
          try {
            const body = JSON.parse(xhr.responseText || '{}');
            message = String(body?.error?.message ?? message);
            code = String(body?.error?.code ?? code);
          } catch {
            // Keep the status.
          }
          finished = true;
          handlers.onError?.(bridgeErrorMessage(code, message), code);
          return;
        }
        // A stream that ended without `done` is still an answer that stopped.
        finished = true;
        handlers.onError?.(t("回复尚未完成，桥接服务就关闭了连接。"), 'incomplete');
      };

      xhr.send(
        JSON.stringify({
          message: input.message,
          ...(input.model ? { model: input.model, provider: input.provider } : {}),
        }),
      );

      return close;
    },
  };
}
