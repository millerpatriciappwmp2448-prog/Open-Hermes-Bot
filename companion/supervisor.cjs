const { createHash, randomUUID } = require('node:crypto');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clip = (value, size = 3000) => typeof value === 'string' ? value.slice(0, size) : '';

function retryDelay(error, attempt, now, random = Math.random) {
  const value = error?.retryAfter ?? error?.retry_after ?? error?.headers?.['retry-after'];
  if (value !== undefined) {
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - now;
    if (Number.isFinite(delay) && delay > 0) return Math.min(delay, 7 * 86400000);
  }
  const base = Math.min(900000, 30000 * 2 ** Math.min(20, Math.max(0, attempt - 1)));
  return Math.round(base * (0.8 + random() * 0.4));
}

function recoverable(error) {
  const text = typeof error === 'string' ? error : JSON.stringify(error || {});
  if (/insufficient[_ ]quota|quota[_ ]exceeded|billing|credits? exhausted|invalid[_ ]api[_ ]key|unauthori[sz]ed|authentication|\b40[13]\b/i.test(text)) return false;
  if (error?.willRetry) return false;
  return /\b429\b|rateLimitExceeded|rate_limit_exceeded|too many requests|ECONNRESET|ETIMEDOUT|EAI_AGAIN|streamDisconnected|httpConnectionFailed|connection (?:reset|closed)|\b50[234]\b/i.test(text);
}

function observation(raw, expectedId) {
  if (!raw?.thread || raw.thread.id !== expectedId || !Array.isArray(raw.turns)) throw new Error('Codex returned a different or unsupported chat.');
  const thread = raw.thread;
  const turn = raw.turns[0];
  const flags = thread.status?.activeFlags || [];
  const attention = thread.status?.type === 'needsAttention' || flags.some(flag => /waitingOnApproval|waitingOnUserInput|approval|userInput/i.test(typeof flag === 'string' ? flag : JSON.stringify(flag)));
  const userItems = (turn?.items || []).filter(item => item.type === 'userMessage');
  const sourceItems = [...userItems.slice(0, 1), ...userItems.slice(-3), ...(turn?.items || []).filter(item => item.type !== 'userMessage').slice(-30)];
  const items = sourceItems.flatMap(item => {
    if (item.type === 'userMessage') return [{ type: item.type, text: (item.content || []).filter(part => part.type === 'text').map(part => clip(part.text)).join('\n').slice(0, 6000) }];
    if (item.type === 'agentMessage') return [{ type: item.type, text: clip(item.text), phase: item.phase }];
    if (item.type === 'commandExecution') return [{ type: item.type, command: clip(item.command, 1000), status: item.status, exitCode: item.exitCode, output: clip(item.aggregatedOutput ?? item.output) }];
    if (item.type === 'mcpToolCall') return [{ type: item.type, tool: clip(item.tool, 100), status: item.status, error: item.error ? clip(JSON.stringify(item.error)) : null }];
    return [];
  });
  let remaining = 20000;
  for (const item of items) {
    for (const key of ['text', 'command', 'output', 'error']) {
      if (typeof item[key] === 'string') { item[key] = item[key].slice(0, Math.max(0, remaining)); remaining -= item[key].length; }
    }
  }
  const deliveredMarkers = [...new Set(raw.turns.flatMap(row => (row.items || []).filter(item => item.type === 'userMessage')
    .flatMap(item => (item.content || []).filter(part => part.type === 'text').flatMap(part => part.text?.match(/\[hermes-supervisor:[a-f0-9-]{36}\]/g) || []))))];
  const state = { threadId: thread.id, title: clip(thread.title, 240), threadStatus: thread.status?.type, attention,
    turnId: turn?.id || '', turnStatus: turn?.status || 'empty', error: turn?.error || null, items };
  return { ...state, deliveredMarkers, fingerprint: digest(state) };
}

function validateSpec(spec) {
  if (!spec || typeof spec.threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(spec.threadId) ||
      !['local', undefined].includes(spec.hostId) || typeof spec.goal !== 'string' || !spec.goal.trim() || spec.goal.length > 8000 ||
      typeof spec.profile !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(spec.profile) ||
      (spec.model !== undefined && (typeof spec.model !== 'string' || spec.model.length > 240)) ||
      (spec.provider !== undefined && (typeof spec.provider !== 'string' || spec.provider.length > 120)) ||
      (spec.reviewEnabled !== undefined && typeof spec.reviewEnabled !== 'boolean')) {
    throw Object.assign(new Error('Choose a local Codex chat, a goal and a Hermes agent.'), { status: 400 });
  }
  return { threadId: spec.threadId, hostId: 'local', goal: spec.goal.trim(), profile: spec.profile,
    model: spec.model || '', provider: spec.provider || '', reviewEnabled: spec.reviewEnabled === true };
}

class Supervisor {
  constructor({ desktop, store, review, clock = Date.now, random = Math.random }) {
    this.desktop = desktop; this.store = store; this.review = review; this.clock = clock; this.random = random;
    this.data = store.load() || { version: 1, enabled: false, state: 'stopped', revision: 0, attempts: 0, events: [], review: { status: 'off' } };
    this.epoch = 0;
    if (this.data.outbox?.status === 'dispatching') { this.data.outbox.status = 'unknown'; this.data.state = 'deliveryUnknown'; this.persist(); }
  }

  persist() { this.store.save(this.data); }
  event(type, message) {
    this.data.events = [...this.data.events, { at: this.clock(), type, message }].slice(-50);
  }
  status() { return structuredClone(this.data); }

  async start(input) {
    const spec = validateSpec(input);
    const resumingDelivery = this.data.outbox?.status === 'unknown' && !this.data.enabled &&
      digest(this.data.spec) === digest(spec);
    if (this.data.outbox && ['dispatching', 'unknown'].includes(this.data.outbox.status) && !resumingDelivery) {
      throw Object.assign(new Error('Confirm the pending message delivery before changing supervision.'), { status: 409 });
    }
    const epoch = ++this.epoch;
    const seen = observation(await this.desktop.read(spec.threadId, spec.hostId), spec.threadId);
    if (epoch !== this.epoch) throw Object.assign(new Error('Supervision changed while connecting. Try again.'), { status: 409 });
    // Preserve uncertain delivery for this target across pause/resume; it must not be retried blindly.
    const previous = this.data.spec?.threadId === spec.threadId ? this.data.outbox : null;
    this.data = { version: 1, spec, enabled: true, revision: (this.data.revision || 0) + 1,
      state: resumingDelivery ? 'deliveryUnknown' : 'watching', attempts: this.data.spec?.threadId === spec.threadId ? this.data.attempts : 0,
      outbox: previous && previous.status !== 'planned' ? previous : null,
      events: this.data.events, observed: seen, review: { status: spec.reviewEnabled ? 'pending' : 'off' } };
    this.event('started', 'Supervision enabled for the selected desktop chat.'); this.persist();
    return this.status();
  }

  pause() {
    ++this.epoch; this.data.enabled = false; this.data.revision++;
    if (this.data.outbox?.status === 'planned') this.data.outbox = null;
    this.data.state = 'paused'; this.event('paused', 'Supervision paused.'); this.persist();
    return this.status();
  }

  async tick() {
    if (!this.data.enabled || this.busy) return;
    this.busy = true;
    const epoch = this.epoch;
    let review;
    try { review = await this.run(epoch); }
    catch (error) {
      if (this.epoch !== epoch) return;
      this.data.state = 'disconnected'; this.data.connectionError = clip(error.message, 500); this.persist();
    } finally { this.busy = false; }
    if (review && this.current(epoch)) await this.analyze(review.seen, epoch, review.canSend);
  }

  current(epoch) { return this.epoch === epoch && this.data.enabled; }

  async run(epoch) {
    const { spec } = this.data;
    const seen = observation(await this.desktop.read(spec.threadId, spec.hostId), spec.threadId);
    if (!this.current(epoch)) return;
    this.data.observed = seen; this.data.sampledAt = this.clock(); delete this.data.connectionError;
    const pending = this.data.outbox;
    if (pending && ['unknown', 'dispatching'].includes(pending.status)) {
      const markerSeen = seen.deliveredMarkers.includes(pending.marker);
      if (markerSeen) {
        pending.status = 'sent';
        if (pending.kind === 'retry') this.data.attempts++;
        this.event('reconciled', 'The previous message is visible in Codex.');
      }
      else { this.data.state = 'deliveryUnknown'; this.persist(); return; }
    }
    if (pending?.status === 'planned' && pending.fingerprint !== seen.fingerprint) {
      this.data.outbox = null; this.event('superseded', 'New desktop activity cancelled the pending instruction.');
    }
    if (seen.attention || seen.turnStatus === 'interrupted' || seen.turnStatus === 'cancelled') {
      this.data.outbox = null; this.data.state = 'attention'; this.persist(); return;
    }
    if (seen.turnStatus === 'inProgress' || seen.threadStatus === 'active' || seen.error?.willRetry) {
      // Quality review can observe work, but automatic instructions wait until the turn is idle.
      this.data.state = 'watching'; this.persist();
      return { seen, canSend: false };
    }
    if (seen.turnStatus === 'failed') {
      if (!recoverable(seen.error)) { this.data.state = 'attention'; this.persist(); return; }
      if (this.data.outbox?.fingerprint === seen.fingerprint && this.data.outbox.status === 'sent') {
        this.data.state = 'awaitingCodex'; this.persist(); return;
      }
      if (!this.data.outbox || this.data.outbox.fingerprint !== seen.fingerprint) {
        const delay = retryDelay(seen.error, this.data.attempts + 1, this.clock(), this.random);
        this.plan(seen, 'retry', `Continue the existing task after the temporary API/connection failure. Follow the user's latest instructions and preserve completed work. Do not restart the task or change model, relay, credentials or permission settings.\nSupervision goal:\n${spec.goal}`, this.clock() + delay);
      }
      this.data.state = 'backoff'; this.persist();
      if (this.clock() >= this.data.outbox.dueAt) await this.dispatch(seen, epoch);
      return;
    }
    this.data.state = 'watching'; this.persist();
    if (this.data.outbox?.status === 'planned') { await this.dispatch(seen, epoch); return; }
    return { seen, canSend: true };
  }

  plan(seen, kind, instruction, dueAt) {
    const marker = `[hermes-supervisor:${randomUUID()}]`;
    this.data.outbox = { marker, kind, fingerprint: seen.fingerprint, turnId: seen.turnId, dueAt, status: 'planned',
      prompt: `${marker}\n${instruction}` };
    this.event('planned', kind === 'retry' ? 'A recoverable failure will be retried after backoff.' : 'Evidence-backed guidance is ready.'); this.persist();
  }

  async dispatch(seen, epoch) {
    const action = this.data.outbox;
    if (!action || action.status !== 'planned' || this.clock() < action.dueAt || !this.current(epoch)) return;
    const fresh = observation(await this.desktop.read(this.data.spec.threadId, this.data.spec.hostId), this.data.spec.threadId);
    if (!this.current(epoch) || this.data.outbox !== action || action.status !== 'planned') return;
    if (fresh.fingerprint !== seen.fingerprint || fresh.attention || fresh.turnStatus === 'inProgress' || fresh.threadStatus === 'active' || fresh.error?.willRetry) {
      this.data.outbox = null; this.data.state = 'watching'; this.persist(); return;
    }
    action.status = 'dispatching'; this.persist();
    try {
      await this.desktop.send(this.data.spec.threadId, action.prompt, this.data.spec.hostId);
      action.status = 'sent';
      if (action.kind === 'retry') this.data.attempts++;
      this.event('sent', action.kind === 'retry' ? 'Sent a continuation to the existing Codex chat.' : 'Sent review guidance to the existing Codex chat.');
      if (this.current(epoch)) this.data.state = 'awaitingCodex';
    } catch (error) {
      if (error.ambiguous) { action.status = 'unknown'; if (this.current(epoch)) this.data.state = 'deliveryUnknown'; }
      else {
        action.status = 'planned'; action.dueAt = this.clock() + retryDelay(null, this.data.attempts + 1, this.clock(), this.random);
        if (this.current(epoch)) this.data.state = 'disconnected';
      }
      this.event('delivery', error.ambiguous ? 'Delivery is uncertain; waiting for the message marker instead of sending again.' : 'Desktop refused delivery; reconnection will retry after backoff.');
    }
    this.persist();
  }

  async analyze(seen, epoch, canSend) {
    if (!this.data.spec.reviewEnabled || !this.review || !seen.turnId ||
        this.reviewBusy?.epoch === epoch ||
        this.data.lastReviewFingerprint === seen.fingerprint || this.clock() < (this.data.nextReviewAt || 0)) return;
    const token = { epoch };
    this.reviewBusy = token;
    this.data.nextReviewAt = this.clock() + 60000; this.data.review = { ...this.data.review, status: 'running' }; this.persist();
    try {
      const result = await this.review(this.data.spec, seen);
      if (!this.current(epoch) || this.data.observed?.fingerprint !== seen.fingerprint) return;
      const fresh = observation(await this.desktop.read(this.data.spec.threadId, this.data.spec.hostId), this.data.spec.threadId);
      if (!this.current(epoch) || fresh.fingerprint !== seen.fingerprint) return;
      this.data.review = { status: 'ready', at: this.clock(), analysis: clip(result.analysis, 6000), recommendation: clip(result.instruction, 4000), action: result.action,
        signals: result.signals };
      this.data.lastReviewFingerprint = seen.fingerprint;
      if (canSend && result.approved === true && ['continue', 'correct'].includes(result.action) && result.instruction?.trim() &&
          !(this.data.outbox?.status === 'sent' && this.data.outbox.fingerprint === seen.fingerprint)) {
        this.plan(seen, 'review', `Supervision goal:\n${this.data.spec.goal}\nEvidence-based guidance (follow the user's latest instructions):\n${result.instruction}`, this.clock());
        await this.dispatch(seen, epoch);
      } else if (canSend && result.action === 'complete' && result.approved === true) {
        this.data.state = 'completed'; this.data.enabled = false; this.event('completed', 'Review found evidence that the supervision goal is complete.');
      }
      this.persist();
    } catch (error) {
      if (!this.current(epoch)) return;
      this.data.review = { status: 'unavailable', at: this.clock(), error: clip(error.message, 500) }; this.persist();
    } finally {
      if (this.reviewBusy === token) this.reviewBusy = null;
      if (this.current(epoch) && this.data.review.status === 'running') {
        this.data.review = { status: 'pending' }; this.persist();
      }
    }
  }
}

module.exports = { Supervisor, retryDelay, recoverable, observation, validateSpec };
