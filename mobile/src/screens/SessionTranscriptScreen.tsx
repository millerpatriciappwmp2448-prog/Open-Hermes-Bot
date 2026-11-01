import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BridgeMessage } from '../api';
import { Page } from '../components/Page';
import { t, useTranslation } from '../i18n';
import type { RootStackParamList } from '../nav';
import { useStore } from '../store';
import { themedStyles } from '../theme';

export function SessionTranscriptScreen({ route }: NativeStackScreenProps<RootStackParamList, 'SessionTranscript'>) {
  useTranslation();
  const { styles, C } = useStyles();
  const { loadTranscript, connection } = useStore();
  const { botId, sessionId, title } = route.params;
  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  const busy = useRef(false);

  async function load(offset: number) {
    if (busy.current) return;
    const ticket = ++latest.current;
    busy.current = true; setLoading(true); setError('');
    try {
      const page = await loadTranscript(botId, sessionId, offset);
      if (ticket !== latest.current) return;
      setMessages(current => {
        const previous = offset === 0 ? [] : current;
        const seen = new Set(previous.map(row => row.id).filter(Boolean));
        return [...previous, ...page.messages.filter(row => {
          if (row.id && seen.has(row.id)) return false;
          if (row.id) seen.add(row.id);
          return true;
        })];
      });
      setNextOffset(page.nextOffset !== null && page.nextOffset > offset ? page.nextOffset : null);
      setLoaded(true);
    } catch {
      if (ticket === latest.current) setError(t('无法读取会话内容。'));
    } finally {
      if (ticket === latest.current) { busy.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    latest.current += 1; busy.current = false;
    setMessages([]); setNextOffset(0); setLoaded(false); setError('');
    void load(0);
    return () => { latest.current += 1; busy.current = false; };
  }, [botId, sessionId, connection.url, connection.status, loadTranscript]);

  return <Page title={t('会话记录')}>
    <View style={styles.heading}><Text style={styles.title} numberOfLines={2}>{title}</Text><Text style={styles.meta}>{t('只读记录')}</Text></View>
    <FlatList testID="session-transcript" data={messages} keyExtractor={(row, index) => row.id || `${sessionId}:${index}`} contentContainerStyle={styles.body}
      renderItem={({ item }) => {
        const mine = item.role === 'user';
        const role = mine ? t('我') : item.role === 'assistant' ? t('智能体') : item.role === 'tool' ? t('工具') : item.role === 'system' ? t('系统') : item.role;
        return <View style={[styles.message, mine && styles.mine]}>
          <Text style={styles.meta}>{role}</Text>
          <View style={[styles.bubble, mine && styles.userBubble]}><Text selectable style={[styles.text, mine && styles.userText]}>{item.content || t('非文本消息')}</Text></View>
        </View>;
      }}
      ListEmptyComponent={loaded && !loading ? <Text style={styles.meta}>{t('此会话暂无消息')}</Text> : undefined}
      ListFooterComponent={<View style={styles.footer}>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={C.green} accessibilityLabel={t('加载中…')} /> : null}
        {!loading && nextOffset !== null ? <Pressable accessibilityRole="button" onPress={() => void load(nextOffset)} style={styles.more}>
          <Text style={styles.link}>{error ? t('重试') : t('加载后续消息')}</Text>
        </Pressable> : null}
      </View>} />
  </Page>;
}

const useStyles = themedStyles(({ C }) => ({
  heading: { padding: 16, gap: 5 },
  title: { fontSize: 15, lineHeight: 21, color: C.text, fontWeight: '500' },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 14 },
  meta: { color: C.text2, fontSize: 11, lineHeight: 17 },
  message: { maxWidth: '94%', alignSelf: 'flex-start', gap: 4 },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: 14, backgroundColor: C.bubble, padding: 12 },
  userBubble: { backgroundColor: C.paper },
  text: { color: C.text, fontSize: 14, lineHeight: 21 },
  userText: { color: C.bg },
  footer: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  more: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  link: { color: C.green, fontSize: 13 },
  error: { color: C.red, fontSize: 12, lineHeight: 18 },
}), false);
