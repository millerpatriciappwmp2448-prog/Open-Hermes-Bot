import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Page } from '../components/Page';
import Markdown from 'react-native-markdown-display';
import { Hint, PrimaryButton } from '../components/UI';
import { Toggle } from '../components/Toggle';
import { ServerModelPicker } from '../components/ServerModelPicker';
import type { CodexChat, CodexSupervisorStatus } from '../codexSupervisor';
import type { ModelRef } from '../modelSelection';
import { localeTag, t, useTranslation } from '../i18n';
import { useAppNavigation } from '../nav';
import { useStore } from '../store';
import { themedStyles } from '../theme';

const STATES: Record<string, string> = {
  stopped: '尚未开始', paused: '已暂停', watching: '正在监督', backoff: '等待自动重试',
  attention: '需要处理', deliveryUnknown: '正在确认消息送达', awaitingCodex: '已发送，等待 Codex',
  disconnected: '电脑连接中断', completed: '目标已完成',
};
const REVIEW_STATES: Record<string, string> = { off: '已关闭', pending: '等待分析', running: '正在分析', ready: '分析已更新', unavailable: '分析暂不可用' };
const time = (value?: number) => value ? new Date(value).toLocaleString(localeTag()) : t('暂无数据');

export function CodexSupervisorScreen() {
  useTranslation();
  const { styles, C, scheme } = useStyles();
  const navigation = useAppNavigation();
  const { connection, bots, modelPicks, loadCodexStatus, loadCodexChats, startCodexWatch, pauseCodexWatch } = useStore();
  const [status, setStatus] = useState<CodexSupervisorStatus | null>(null);
  const [chats, setChats] = useState<CodexChat[]>([]);
  const [threadId, setThreadId] = useState('');
  const [goal, setGoal] = useState('');
  const supervisor = bots.find(bot => bot.capabilities?.includes('codex-supervisor'));
  const profile = supervisor?.id || '';
  const [reviewEnabled, setReviewEnabled] = useState(true);
  const [pickOverride, setPick] = useState<ModelRef | null | undefined>(undefined);
  const pick = pickOverride === undefined ? modelPicks[profile] || null : pickOverride;
  const [modelOpen, setModelOpen] = useState(false);
  const [error, setError] = useState('');
  const [chatsError, setChatsError] = useState('');
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const edited = useRef(false);
  const mounted = useRef(true);
  const statusPending = useRef<symbol | null>(null);
  const chatsPending = useRef<symbol | null>(null);
  const acting = useRef(false);
  const generation = useRef(0);
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const connected = connection.status === 'connected';
  const saved = status?.spec;
  const unchanged = status?.enabled && saved?.threadId === threadId && saved.goal === goal.trim() &&
    saved.profile === profile && saved.reviewEnabled === reviewEnabled &&
    (saved.model || '') === (pick?.model || '') && (saved.provider || '') === (pick?.provider || '');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => listener.remove();
  }, []);

  const refresh = useCallback(async () => {
    if (!connected || busy || acting.current) return;
    const version = generation.current;
    const current = () => mounted.current && version === generation.current;
    const reads: Promise<void>[] = [];
    // Each endpoint has its own lock: a slow companion/status read must not
    // hide healthy chat results, and a slow list must not block pause/status.
    if (!statusPending.current) {
      const request = Symbol(); statusPending.current = request;
      reads.push((async () => {
        try {
          const value = await loadCodexStatus();
          if (!current()) return;
          setStatus(value); setError('');
          if (!initialized.current) {
            initialized.current = true;
            if (value.spec && !edited.current) {
              setThreadId(value.spec.threadId); setGoal(value.spec.goal);
              setReviewEnabled(value.spec.reviewEnabled);
              if (value.spec.profile === profile) {
                setPick(value.spec.model ? { model: value.spec.model, provider: value.spec.provider || '' } : null);
              }
            }
          }
        } catch (e) {
          if (current()) setError(e instanceof Error ? e.message : t('无法读取监督状态。'));
        } finally {
          if (statusPending.current === request) statusPending.current = null;
        }
      })());
    }
    if (!chatsPending.current) {
      const request = Symbol(); chatsPending.current = request; setLoading(true);
      reads.push((async () => {
        try {
          const rows = await loadCodexChats();
          if (current()) {
            setChats(rows); setChatsError(''); setChatsLoaded(true);
          }
        } catch (e) {
          if (current()) setChatsError(e instanceof Error ? e.message : t('无法读取 Codex 会话。'));
        } finally {
          if (chatsPending.current === request) {
            chatsPending.current = null;
            if (current()) setLoading(false);
          }
        }
      })());
    }
    await Promise.all(reads);
  }, [busy, connected, connection.url, loadCodexChats, loadCodexStatus, profile]);

  useEffect(() => {
    generation.current++; initialized.current = false; edited.current = false;
    statusPending.current = null; chatsPending.current = null; setLoading(false);
    setStatus(null); setChats([]); setThreadId(''); setGoal('');
    setChatsError(''); setChatsLoaded(false); setPick(undefined);
  }, [connection.url]);
  useEffect(() => {
    if (!connected) {
      generation.current++; statusPending.current = null; chatsPending.current = null; setLoading(false);
    }
  }, [connected]);
  useEffect(() => {
    if (!connected || !focused || !appActive) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => clearInterval(timer);
  }, [appActive, connected, focused, refresh]);

  async function act(pause: boolean) {
    if (acting.current || (!pause && (unchanged || !profile))) return;
    acting.current = true;
    const version = ++generation.current;
    statusPending.current = null; chatsPending.current = null; setLoading(false);
    setBusy(true); setError('');
    try {
      const value = pause ? await pauseCodexWatch() : await startCodexWatch({ threadId, hostId: 'local', goal: goal.trim(), profile,
        model: pick?.model || '', provider: pick?.provider || '', reviewEnabled });
      if (mounted.current && version === generation.current) setStatus(value);
    } catch (e) {
      if (mounted.current && version === generation.current) setError(e instanceof Error ? e.message : t('无法更新监督任务。'));
    } finally { acting.current = false; if (mounted.current) setBusy(false); }
  }

  if (!connected) return <Page title={t('Codex 监督')}><View style={styles.body}>
    <Hint>{t('连接 Hermes 后，选择电脑上正在使用的 Codex 会话。')}</Hint>
    <PrimaryButton label={t('连接服务器')} onPress={() => navigation.navigate('Connection')} />
  </View></Page>;

  if (modelOpen) return <Page title={t('监督模型')} right={<Pressable accessibilityRole="button" onPress={() => setModelOpen(false)} style={styles.refresh}>
    <Text style={styles.link}>{t('完成')}</Text></Pressable>}>
    <ServerModelPicker botId={profile} draftPick={pick} onDraftPick={value => { edited.current = true; setPick(value); }} onPicked={() => setModelOpen(false)} />
  </Page>;

  return <Page title={t('Codex 监督')} right={<Pressable accessibilityRole="button" accessibilityLabel={t('刷新监督状态')}
    disabled={loading || busy} onPress={() => void refresh()} style={styles.refresh}><Text style={styles.link}>{t('刷新')}</Text></Pressable>}>
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={styles.heading}>{t('让工作持续进行')}</Text>
      <Text style={styles.caption}>{t('临时 429 或连接错误会自动等待并续做；监督任务在电脑上运行，关闭手机也会继续。')}</Text>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {!status && !error ? <Hint>{t('读取中')}</Hint> : null}
      {status ? <View style={styles.card}>
        <View style={styles.between}><Text style={styles.cardTitle}>{t(STATES[status.state] || '正在监督')}</Text>
          <View style={[styles.dot, { backgroundColor: status.enabled ? C.green : C.text2 }]} /></View>
        <Text style={styles.caption}>{status.observed?.title || t('尚未选择会话')}</Text>
        <Text style={styles.caption}>{t('自动续做次数：{0}', { 0: status.attempts || 0 })}</Text>
        {status.outbox?.status === 'planned' ? <Text style={styles.caption}>{t('下次重试：{0}', { 0: time(status.outbox.dueAt) })}</Text> : null}
        {status.state === 'deliveryUnknown' ? <Text style={styles.caption}>{t('发送回执丢失，正在核对原会话中的消息，避免重复续做。')}</Text> : null}
        {status.state === 'attention' ? <Text style={styles.caption}>{t('请检查 Codex 的授权、额度、人工审批或手动停止状态。')}</Text> : null}
        {status.connectionError ? <Text style={styles.error}>{status.connectionError}</Text> : null}
        {status.enabled ? <PrimaryButton label={t('暂停监督')} tone="quiet" disabled={busy} onPress={() => void act(true)} /> : null}
      </View> : null}

      <Text style={styles.label}>{t('监督哪个 Codex 会话')}</Text>
      {chatsError ? <Text accessibilityRole="alert" style={styles.error}>{chatsError}</Text> : null}
     {chatsError && chatsError.toLowerCase().includes('companion') ? <View style={styles.card}>
       <Text style={styles.cardTitle}>{t('需要 Codex companion')}</Text>
       <Text style={styles.copy}>{t('监督功能需要在 Hermes 服务器上运行 Codex companion。')}</Text>
       <Text style={styles.caption}>{t('• 在服务器运行: node companion/desktop.cjs')}</Text>
       <Text style={styles.caption}>{t('• 配置环境变量或 companion 配置文件')}</Text>
       <Text style={styles.caption}>{t('• 详见仓库 companion/README.md')}</Text>
     </View> : chats.length ? <View style={styles.list}>{chats.map(chat => <Pressable key={chat.id} accessibilityRole="radio"
        accessibilityState={{ selected: threadId === chat.id }} disabled={busy} onPress={() => { edited.current = true; setThreadId(chat.id); }}
        style={[styles.choice, threadId === chat.id && styles.selected]}>
        <Text style={styles.choiceTitle}>{chat.title || chat.id}</Text>
        <Text style={styles.caption}>{chat.status?.type === 'active' ? t('正在运行') : t('已有会话')}{threadId === chat.id ? ` · ${t('已选择')}` : ''}</Text>
       {chat.messages && chat.messages.length > 0 && <View style={styles.messagePreview}>
         {chat.messages.map((msg, idx) => msg.role === 'assistant' && <View key={idx} style={styles.assistantMessage}>
           <Markdown style={markdownStyle({ C, scheme })}>{msg.content}</Markdown>
         </View>)}
       </View>}
      </Pressable>)}</View> : !chatsError ? <Text style={styles.caption}>{loading || !chatsLoaded ? t('读取中') : t('电脑上暂无可用的 Codex 会话。')}</Text> : null}
      <Text style={styles.label}>{t('目标与监督指令')}</Text>
      <TextInput accessibilityLabel={t('目标与监督指令')} value={goal} onChangeText={value => { edited.current = true; setGoal(value); }} multiline maxLength={8000}
        editable={!busy} keyboardAppearance={scheme} textAlignVertical="top" style={styles.input}
        placeholder={t('说明任务完成标准、要检查的问题和允许自动纠正的范围。')} placeholderTextColor={C.text2} />

      <View style={styles.between}><Text style={styles.label}>{t('分析与自动纠偏')}</Text><Toggle on={reviewEnabled} onChange={() => { edited.current = true; setReviewEnabled(value => !value); }} label={t('分析与自动纠偏')} /></View>
      <Text style={styles.caption}>{t('由 Codex 监督员分析证据并提出纠偏建议。')}</Text>
      {reviewEnabled ? <>
        <Pressable accessibilityRole="button" disabled={!profile || busy} onPress={() => setModelOpen(true)} style={styles.card}>
          <Text style={styles.choiceTitle}>{t('监督模型')}</Text><Text style={styles.caption}>{pick?.model || t('跟随服务器')}</Text>
        </Pressable>
      </> : null}
      {!profile ? <Text style={styles.error}>{t('未找到 Codex 监督员，请刷新智能体列表。')}</Text> : null}
      <PrimaryButton label={busy ? t('保存中…') : status?.enabled ? t('保存监督设置') : t('开始监督')}
        disabled={busy || loading || !threadId || !goal.trim() || !profile || !status || Boolean(unchanged)} onPress={() => void act(false)} />
      <Text style={styles.caption}>{t('开始后，可自动向选定会话发送续做和纠偏指令，无需逐次确认。')}</Text>

      {status?.review ? <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('分析与建议')}</Text>
        <Text style={styles.caption}>{t(REVIEW_STATES[status.review.status] || '等待分析')}</Text>
        {status.review.analysis ? <Text selectable style={styles.copy}>{status.review.analysis}</Text> : null}
        {status.review.recommendation ? <Text selectable style={styles.copy}>{status.review.recommendation}</Text> : null}
        {status.review.error ? <Text style={styles.error}>{status.review.error}</Text> : null}
      </View> : null}
      {status?.events?.length ? <View style={styles.card}><Text style={styles.cardTitle}>{t('最近动作')}</Text>
        {status.events.slice(-6).reverse().map((event, index) => <View key={`${event.at}:${index}`} style={styles.event}>
          <Text style={styles.caption}>{time(event.at)}</Text><Text style={styles.copy}>{event.message}</Text></View>)}
      </View> : null}
    </ScrollView>
  </Page>;
}

const useStyles = themedStyles(({ C }) => ({
  body: { padding: 20, paddingBottom: 40, gap: 12 },
  heading: { color: C.text, fontSize: 23, fontWeight: '600', marginTop: 6 },
  label: { color: C.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  caption: { color: C.text2, fontSize: 12, lineHeight: 19 },
  copy: { color: C.text, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: C.cardRaised, borderColor: C.line, borderWidth: 1, borderRadius: 15, padding: 15, gap: 8 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '600' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  dot: { height: 8, width: 8, borderRadius: 4 },
  list: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  choice: { padding: 13, gap: 4, backgroundColor: C.cardRaised, borderBottomWidth: 1, borderBottomColor: C.hairline },
  choiceTitle: { color: C.text, fontSize: 14, fontWeight: '500' },
  selected: { backgroundColor: C.selected, borderLeftWidth: 3, borderLeftColor: C.green },
  input: { color: C.text, backgroundColor: C.field, borderRadius: 14, padding: 14, minHeight: 120, fontSize: 14, lineHeight: 21 },
  error: { color: C.red, fontSize: 12, lineHeight: 19 },
  refresh: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  link: { color: C.text, fontSize: 12 },
  event: { gap: 3, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.hairline },
  messagePreview: { marginTop: 8, gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.hairline },
  assistantMessage: { backgroundColor: C.field, borderRadius: 10, padding: 10 },
}), false);

const markdownStyle = ({ C, scheme }: { C: Record<string, string>; scheme: string }) => ({
  body: { color: C.text, fontSize: 13, lineHeight: 20 },
  paragraph: { marginVertical: 2 },
  code_inline: { backgroundColor: C.cardRaised, color: C.text, fontSize: 12, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  fence: { backgroundColor: C.cardRaised, color: C.text, fontSize: 12, padding: 8, borderRadius: 6, marginVertical: 4 },
  link: { color: scheme === 'dark' ? '#38BDF8' : '#0066CC' },
});
