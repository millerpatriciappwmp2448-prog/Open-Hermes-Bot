import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Message } from '../data';
import { t, useTranslation } from '../i18n';
import {
  deliverText,
  distance,
  draftBody,
  draftProblem,
  emptyText,
  lastRunText,
  nextRunText,
  runsByJob,
  schedulerStanding,
  type Schedule,
  type ScheduleRun,
  type ScheduleState,
} from '../schedules';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { Bloub } from './Bloub';
import { ChevronIcon } from './Icons';

// What a bot is for and what it runs on its own. Everything here is read from
// and written to the server through the bridge; the phone keeps none of it.

const LIMIT = 600;

function failure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function BotIdentity({ botId, caption }: { botId: string; caption: string }) {
  const { styles, C } = useStyles();
  const { botById } = useStore();
  const bot = botById(botId);
  return (
    <View style={styles.identity}>
      <View style={styles.avatar}><Bloub shape={bot?.shape} color={bot?.color ?? C.green} size={36} /></View>
      <View style={styles.flex}>
        <Text style={styles.botName} numberOfLines={1}>{bot?.name}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
    </View>
  );
}

/** The bot's role, kept in the app's block of its SOUL.md. */
export function DescriptionEditor({ botId, onSaved }: { botId: string; onSaved?: () => void }) {
  const { styles, C, scheme } = useStyles();
  useTranslation();
  const { botById, saveDescription } = useStore();
  const stored = botById(botId)?.description ?? '';
  const [text, setText] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const changed = text.trim() !== stored.trim();
  const disabled = busy || !changed;

  async function save() {
    if (pending.current || !changed) return;
    pending.current = true;
    setBusy(true); setError(''); setSaved(false);
    try {
      await saveDescription(botId, text);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(failure(e, t('描述未保存，请重试。')));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <BotIdentity botId={botId} caption={t('描述')} />
      <Text style={styles.caption}>{t('说明这个机器人负责什么。从下一次新会话生效，保存在服务器 SOUL.md 中由本应用管理的段落。')}</Text>
      <View style={styles.field}>
        <TextInput keyboardAppearance={scheme} accessibilityLabel={t('描述')} value={text}
          onChangeText={(value) => { setText(value); setSaved(false); setError(''); }}
          placeholder={t('例如：负责每天的科技新闻简报')} placeholderTextColor={C.text2}
          style={[styles.input, styles.multiline]} multiline maxLength={LIMIT} editable={!busy}
          textAlignVertical="top" />
        <Text style={styles.counter}>{text.length}/{LIMIT}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled}
        onPress={() => void save()} style={({ pressed }) => [styles.apply, disabled && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.applyText}>{busy ? t('正在保存…') : t('保存')}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {saved && !busy ? <Text accessibilityLiveRegion="polite" style={styles.success}>{t('已保存到服务器。')}</Text> : null}
    </ScrollView>
  );
}

const STATE_LABEL: Record<ScheduleState, string> = {
  scheduled: '已计划',
  paused: '已暂停',
  done: '已完成',
  failed: '失败',
  unknown: '未知',
};

function StateBadge({ state }: { state: ScheduleState }) {
  const { styles, C } = useStyles();
  const color = state === 'scheduled' ? C.green : state === 'failed' ? C.red : state === 'paused' ? C.warning : C.text2;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{t(STATE_LABEL[state])}</Text>
    </View>
  );
}

type RunRef = { id: string; title: string };

/** The bot's jobs on the server, where each stands, and its latest runs. */
export function JobsPage({ botId, onNew, onOpenRun, onCount, reloadKey = 0 }: {
  botId: string;
  onNew: () => void;
  onOpenRun: (run: RunRef) => void;
  onCount?: (count: number) => void;
  reloadKey?: number;
}) {
  const { styles, C } = useStyles();
  useTranslation();
  const { loadJobs, loadRuns, jobAction } = useStore();
  const [jobs, setJobs] = useState<Schedule[] | null>(null);
  const [runs, setRuns] = useState<Record<string, ScheduleRun[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [acting, setActing] = useState('');
  const [notice, setNotice] = useState<{ id: string; text: string; bad: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef(false);
  const latest = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function reload() {
    const ticket = ++latest.current;
    setLoading(true); setError('');
    try {
      const [list, sessions] = await Promise.all([loadJobs(botId), loadRuns(botId).catch(() => [])]);
      if (!alive.current || ticket !== latest.current) return;
      setJobs(list);
      setRuns(runsByJob(sessions));
      setNow(Date.now());
      onCount?.(list.length);
    } catch (e) {
      if (!alive.current || ticket !== latest.current) return;
      setError(failure(e, t('无法读取定时任务。')));
    } finally {
      if (alive.current && ticket === latest.current) setLoading(false);
    }
  }
  useEffect(() => { void reload(); }, [botId, reloadKey]);

  async function act(job: Schedule, action: 'pause' | 'resume' | 'run') {
    if (pending.current) return;
    pending.current = true;
    setActing(`${job.id}:${action}`); setNotice(null);
    try {
      await jobAction(botId, job.id, action);
      if (!alive.current) return;
      if (action === 'run') setNotice({ id: job.id, text: t('已开始运行，结果稍后出现在最近运行里。'), bad: false });
      await reload();
    } catch (e) {
      if (alive.current) setNotice({ id: job.id, text: failure(e, t('操作失败，请重试。')), bad: true });
    } finally {
      pending.current = false;
      if (alive.current) setActing('');
    }
  }

  const standing = schedulerStanding(jobs ?? [], now);

  function actionButton(job: Schedule, action: 'pause' | 'resume' | 'run') {
    const busy = acting === `${job.id}:${action}`;
    const disabled = Boolean(acting);
    const label = action === 'pause' ? t('暂停') : action === 'resume' ? t('恢复') : t('立即运行');
    return (
      <Pressable key={action} accessibilityRole="button" accessibilityLabel={`${label} · ${job.name}`}
        accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => void act(job, action)}
        style={({ pressed }) => [styles.action, action === 'run' && styles.actionMain, disabled && !busy && styles.disabled, pressed && styles.pressed]}>
        {busy ? <ActivityIndicator size="small" color={action === 'run' ? C.bg : C.text} /> : null}
        <Text style={[styles.actionText, action === 'run' && styles.actionMainText]}>
          {busy && action === 'run' ? t('正在运行…') : label}
        </Text>
      </Pressable>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.between}>
        <Text style={styles.section}>
          {jobs ? t('{0} 个任务', { 0: jobs.length }) : t('定时任务')}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('刷新')} disabled={loading}
          onPress={() => void reload()} style={({ pressed }) => [styles.refresh, pressed && styles.pressed, loading && styles.disabled]}>
          {loading ? <ActivityIndicator size="small" color={C.green} /> : <Text style={styles.refreshText}>{t('刷新')}</Text>}
        </Pressable>
      </View>

      {standing.text ? <View style={styles.warningBox}><Text style={styles.warning}>{standing.text}</Text></View> : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void reload()} disabled={loading}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <Text style={styles.refreshText}>{t('重试')}</Text>
          </Pressable>
        </View>
      ) : null}

      {!jobs && loading ? (
        <View style={styles.loading}><ActivityIndicator color={C.green} /><Text style={styles.caption}>{t('加载中…')}</Text></View>
      ) : null}

      {jobs && !jobs.length ? (
        <View style={styles.empty}>
          <Text style={styles.name}>{emptyText()}</Text>
          <Text style={styles.meta}>{t('例如：每天整理科技新闻，用中文写成 5 条要点。')}</Text>
        </View>
      ) : null}

      {(jobs ?? []).map((job) => {
        const next = nextRunText(job, now);
        const recent = (runs[job.id] ?? []).slice(0, 3);
        const own = notice?.id === job.id ? notice : null;
        return (
          <View key={job.id} style={styles.card}>
            <View style={styles.cardBody}>
              <View style={styles.titleRow}>
                <Text style={[styles.name, styles.flex]} numberOfLines={2}>{job.name}</Text>
                <StateBadge state={job.state} />
              </View>
              {job.when ? <Text style={styles.when}>{job.when}</Text> : null}
              {job.prompt && job.prompt !== job.name ? <Text style={styles.meta} numberOfLines={2}>{job.prompt}</Text> : null}
              <View style={styles.facts}>
                {next ? <Fact label={t('下次运行')} value={next} /> : null}
                <Fact label={t('上次运行')} value={lastRunText(job, now)} bad={job.state === 'failed'} />
                <Fact label={t('投递')} value={deliverText(job.deliver)} />
              </View>
              {job.state !== 'done' ? (
                <View style={styles.actions}>
                  {actionButton(job, job.state === 'paused' ? 'resume' : 'pause')}
                  {actionButton(job, 'run')}
                </View>
              ) : null}
              {own ? (
                <Text accessibilityLiveRegion="polite" style={own.bad ? styles.error : styles.success}>{own.text}</Text>
              ) : null}
            </View>
            {recent.length ? (
              <View style={styles.runs}>
                <Text style={styles.runsLabel}>{t('最近运行')}</Text>
                {recent.map((run) => (
                  <Pressable key={run.id} accessibilityRole="button" accessibilityLabel={`${run.title} · ${distance(run.at, now)}`}
                    onPress={() => onOpenRun({ id: run.id, title: run.title })}
                    style={({ pressed }) => [styles.run, pressed && styles.pressed]}>
                    <Text style={[styles.runTitle, styles.flex]} numberOfLines={1}>{run.title}</Text>
                    <Text style={styles.runTime}>{distance(run.at, now)}</Text>
                    <ChevronIcon size={10} color={C.text2} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      <Pressable accessibilityRole="button" onPress={onNew}
        style={({ pressed }) => [styles.apply, pressed && styles.pressed]}>
        <Text style={styles.applyText}>{t('新建定时任务')}</Text>
      </Pressable>
      <Text style={styles.footnote}>{t('服务器启用 cron 后，也可以直接在聊天里说“每天 9 点……”，机器人会自己创建任务。')}</Text>
    </ScrollView>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  const { styles } = useStyles();
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, bad && styles.factBad]} numberOfLines={3}>{value}</Text>
    </View>
  );
}

type Preset = 'daily' | 'every2h' | 'custom';
const PRESETS: { id: Preset; label: string; when: string }[] = [
  { id: 'daily', label: '每天 9:00', when: '0 9 * * *' },
  { id: 'every2h', label: '每 2 小时', when: 'every 2h' },
  { id: 'custom', label: '自定义', when: '' },
];

/** A new job: a name, when it runs (in the server's timezone), and what to do. */
export function NewJobForm({ botId, onCreated }: { botId: string; onCreated: () => void }) {
  const { styles, C, scheme } = useStyles();
  useTranslation();
  const { createJob } = useStore();
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<Preset>('daily');
  const [custom, setCustom] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const when = preset === 'custom' ? custom : PRESETS.find((p) => p.id === preset)!.when;

  async function create() {
    if (pending.current) return;
    const draft = { name, when, prompt, deliver: 'local', repeat: '' };
    const problem = draftProblem(draft);
    if (problem) { setError(problem); return; }
    pending.current = true;
    setBusy(true); setError('');
    try {
      await createJob(botId, draftBody(draft));
      onCreated();
    } catch (e) {
      setError(failure(e, t('操作失败，请重试。')));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <BotIdentity botId={botId} caption={t('新建定时任务')} />
      <Text style={styles.label}>{t('任务名称')}</Text>
      <TextInput keyboardAppearance={scheme} accessibilityLabel={t('任务名称')} value={name} onChangeText={setName}
        placeholder={t('例如：早间新闻')} placeholderTextColor={C.text2} style={styles.input} maxLength={200} editable={!busy} />

      <Text style={styles.label}>{t('运行时间')}</Text>
      <View style={styles.chips}>
        {PRESETS.map((item) => {
          const on = preset === item.id;
          return (
            <Pressable key={item.id} accessibilityRole="radio" aria-checked={on} accessibilityState={{ checked: on }}
              disabled={busy} onPress={() => setPreset(item.id)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(item.label)}</Text>
            </Pressable>
          );
        })}
      </View>
      {preset === 'custom' ? (
        <TextInput keyboardAppearance={scheme} accessibilityLabel={t('运行时间')} value={custom} onChangeText={setCustom}
          placeholder="0 9 * * MON-FRI / every 30m / in 2h" placeholderTextColor={C.text2} style={styles.input}
          autoCapitalize="none" autoCorrect={false} editable={!busy} />
      ) : null}
      <Text style={styles.caption}>{when ? `${when} · ${t('按服务器时区')}` : t('按服务器时区')}</Text>

      <Text style={styles.label}>{t('要做什么')}</Text>
      <TextInput keyboardAppearance={scheme} accessibilityLabel={t('要做什么')} value={prompt} onChangeText={setPrompt}
        placeholder={t('例如：每天整理科技新闻，用中文写成 5 条要点。')} placeholderTextColor={C.text2}
        style={[styles.input, styles.multiline]} multiline maxLength={5000} editable={!busy} textAlignVertical="top" />
      <Text style={styles.caption}>{`${t('投递')} · ${deliverText('local')}`}</Text>

      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy}
        onPress={() => void create()} style={({ pressed }) => [styles.apply, busy && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.applyText}>{busy ? t('正在保存…') : t('创建')}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

/** One scheduled run, read back as it happened on the server. */
export function RunTranscript({ botId, runId }: { botId: string; runId: string }) {
  const { styles, C } = useStyles();
  useTranslation();
  const { loadRunMessages } = useStore();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  async function load() {
    const ticket = ++latest.current;
    setLoading(true); setError('');
    try {
      const list = await loadRunMessages(botId, runId);
      if (ticket === latest.current) setMessages(list);
    } catch (e) {
      if (ticket === latest.current) setError(failure(e, t('无法读取这次运行。')));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); return () => { latest.current += 1; }; }, [botId, runId]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {loading && !messages ? (
        <View style={styles.loading}><ActivityIndicator color={C.green} /><Text style={styles.caption}>{t('加载中…')}</Text></View>
      ) : null}
      {error ? (
        <View style={styles.errorBox}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <Text style={styles.refreshText}>{t('重试')}</Text>
          </Pressable>
        </View>
      ) : null}
      {messages && !messages.length ? <Text style={styles.caption}>{t('这次运行没有可显示的消息')}</Text> : null}
      {(messages ?? []).map((message) => {
        const mine = message.from === 'user';
        return (
          <View key={message.id} style={[styles.bubble, mine ? styles.bubbleUser : styles.bubbleBot]}>
            <Text selectable style={mine ? styles.bubbleUserText : styles.bubbleBotText}>{message.text}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

// Native point sizes, like the model picker.
const useStyles = themedStyles(({ C }) => ({
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  botName: { color: C.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  caption: { color: C.text2, fontSize: 12, lineHeight: 18 },
  label: { color: C.text2, fontSize: 12, fontWeight: '500', marginTop: 4, marginBottom: -4 },
  section: { color: C.text2, fontSize: 12, fontWeight: '500', flexShrink: 1 },
  name: { color: C.text, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  meta: { color: C.text2, fontSize: 12, lineHeight: 18 },
  field: { backgroundColor: C.field, borderRadius: 12 },
  input: { minHeight: 46, backgroundColor: C.field, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, lineHeight: 20, color: C.text },
  multiline: { minHeight: 120 },
  counter: { color: C.text2, fontSize: 11, textAlign: 'right', paddingHorizontal: 12, paddingBottom: 8 },
  apply: { minHeight: 46, padding: 12, backgroundColor: C.paper, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: C.bg, fontSize: 14, fontWeight: '600' },
  refresh: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  refreshText: { color: C.green, fontSize: 13, fontWeight: '500' },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  warningBox: { borderRadius: 12, borderWidth: 1, borderColor: C.warning, padding: 12 },
  warning: { color: C.warning, fontSize: 12, lineHeight: 18 },
  errorBox: { gap: 2 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  empty: { backgroundColor: C.cardRaised, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 6 },
  card: { backgroundColor: C.cardRaised, borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  cardBody: { padding: 14, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  when: { color: C.text, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '500' },
  facts: { gap: 6, paddingTop: 2 },
  fact: { flexDirection: 'row', gap: 10 },
  factLabel: { color: C.text2, fontSize: 12, lineHeight: 18, width: 64 },
  factValue: { color: C.text, fontSize: 12, lineHeight: 18, flex: 1, minWidth: 0 },
  factBad: { color: C.red },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  action: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
  actionMain: { backgroundColor: C.paper, borderColor: C.paper },
  actionText: { color: C.text, fontSize: 13, fontWeight: '500' },
  actionMainText: { color: C.bg, fontWeight: '600' },
  runs: { borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  runsLabel: { color: C.text2, fontSize: 11, fontWeight: '500', marginBottom: 2 },
  run: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  runTitle: { color: C.text, fontSize: 13 },
  runTime: { color: C.text2, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: C.line, justifyContent: 'center' },
  chipOn: { backgroundColor: C.selected, borderColor: C.selectedBorder },
  chipText: { color: C.text2, fontSize: 13 },
  chipTextOn: { color: C.green, fontWeight: '500' },
  bubble: { maxWidth: '88%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: C.paper },
  bubbleBot: { alignSelf: 'flex-start', backgroundColor: C.bubble },
  bubbleUserText: { color: C.bg, fontSize: 14, lineHeight: 20 },
  bubbleBotText: { color: C.text, fontSize: 14, lineHeight: 20 },
  error: { color: C.red, fontSize: 13, lineHeight: 20 },
  success: { color: C.green, fontSize: 12, lineHeight: 18 },
  footnote: { color: C.text2, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 4 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
}), false);
