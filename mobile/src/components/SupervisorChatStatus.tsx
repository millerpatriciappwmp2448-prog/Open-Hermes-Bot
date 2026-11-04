import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { CodexSupervisorStatus } from '../codexSupervisor';
import { t, useTranslation } from '../i18n';
import { useStore } from '../store';
import { themedStyles } from '../theme';

const STATES: Record<string, string> = {
  stopped: '尚未开始', paused: '已暂停', watching: '正在监督', backoff: '等待自动重试',
  attention: '需要处理', deliveryUnknown: '正在确认消息送达', awaitingCodex: '已发送，等待 Codex',
  disconnected: '电脑连接中断', completed: '目标已完成',
};

export function SupervisorChatStatus({ onDetails, revision }: { onDetails: () => void; revision: string }) {
  useTranslation();
  const { styles } = useStyles();
  const { loadCodexStatus, connection } = useStore();
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [status, setStatus] = useState<CodexSupervisorStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    setStatus(null); setError('');
  }, [connection.url]);
  useEffect(() => {
    if (!focused || !appActive || connection.status !== 'connected') return;
    let current = true, pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const value = await loadCodexStatus();
        if (current) { setStatus(value); setError(''); }
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : t('无法读取监督状态。'));
      } finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => { current = false; clearInterval(timer); };
  }, [appActive, connection.status, connection.url, focused, loadCodexStatus, revision]);

  return <View style={styles.card} testID="supervisor-chat-status">
    <View style={styles.heading}>
      <Text style={styles.state}>{t(STATES[status?.state || ''] || 'Codex 监督')}</Text>
      <Pressable onPress={onDetails} accessibilityRole="button" accessibilityLabel={t('查看监督详情')} hitSlop={8}>
        <Text style={styles.link}>{t('查看监督详情')}</Text>
      </Pressable>
    </View>
    {status?.spec ? <>
      <Text style={styles.target} numberOfLines={1}>{status.observed?.title || status.spec.threadId}</Text>
      <Text style={styles.goal} numberOfLines={3}>{status.spec.goal}</Text>
      <Text style={styles.meta}>{t('自动续做次数：{0}', { '0': status.attempts || 0 })}</Text>
    </> : <Text style={styles.goal}>{t('选择一个 Codex 会话并告诉我完成标准，就能开始监督。')}</Text>}
    {status?.review?.analysis ? <Text style={styles.analysis} numberOfLines={5}>{status.review.analysis}</Text> : null}
    {status?.review?.error ? <Text style={styles.error}>{status.review.error}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Text style={styles.meta}>{t('监督在电脑上持续运行，关闭手机也会继续。')}</Text>
  </View>;
}

const useStyles = themedStyles(({ C }) => ({
  card: { padding: 14, marginBottom: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.cardRaised, gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  state: { color: C.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  link: { color: C.text2, fontSize: 11 },
  target: { color: C.text, fontSize: 13, fontWeight: '500' },
  goal: { color: C.text2, fontSize: 12, lineHeight: 18 },
  meta: { color: C.text3, fontSize: 10, lineHeight: 16 },
  analysis: { color: C.text2, fontSize: 12, lineHeight: 18, paddingTop: 4 },
  error: { color: C.text, fontSize: 11, lineHeight: 17 },
}));
