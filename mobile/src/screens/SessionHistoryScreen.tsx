import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BridgeError, type BridgeSession } from '../api';
import { Page } from '../components/Page';
import { ChevronIcon } from '../components/Icons';
import { Hint, PrimaryButton } from '../components/UI';
import { localeTag, t, useTranslation } from '../i18n';
import type { RootStackParamList } from '../nav';
import { filterSessions, mergeSessions, sessionKind, type SessionFilter } from '../sessionHistory';
import { useStore } from '../store';
import { themedStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SessionHistory'>;

export function SessionHistoryScreen({ route, navigation }: Props) {
  useTranslation();
  const { styles, C, scheme } = useStyles();
  const { bots, connection, loadHistory } = useStore();
  const [botId, setBotId] = useState(route.params?.botId ?? bots[0]?.id ?? '');
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<BridgeSession[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const revision = useRef(0);
  const busy = useRef(false);
  const visible = useMemo(() => filterSessions(rows, filter, query), [rows, filter, query]);
  const online = connection.status === 'connected';

  async function load(reset: boolean) {
    if (busy.current || !botId || !online || (!reset && nextOffset === null)) return;
    const ticket = ++revision.current;
    const offset = reset ? 0 : nextOffset!;
    busy.current = true; setLoading(true); setError('');
    try {
      const page = await loadHistory(botId, offset);
      if (ticket !== revision.current) return;
      setRows(current => mergeSessions(reset ? [] : current, page.sessions));
      setNextOffset(page.nextOffset !== null && page.nextOffset > offset ? page.nextOffset : null);
      setLoaded(true);
    } catch (e) {
      if (ticket === revision.current) setError(e instanceof BridgeError && e.status === 404
        ? t('请更新服务器桥接服务以查看全部来源的会话。') : t('无法读取会话记录。'));
    } finally {
      if (ticket === revision.current) { busy.current = false; setLoading(false); }
    }
  }

  useEffect(() => {
    revision.current += 1; busy.current = false;
    setRows([]); setNextOffset(null); setLoaded(false); setError(''); setLoading(false);
    void load(true);
    return () => { revision.current += 1; busy.current = false; };
  }, [botId, connection.status, connection.url, loadHistory]);

  function sourceLabel(row: BridgeSession) {
    const kind = sessionKind(row);
    return kind === 'scheduled' ? t('定时任务') : kind === 'chat' ? t('应用会话') : row.source || t('来源未知');
  }

  return <Page title={t('服务器会话')} right={online ? <Pressable accessibilityRole="button"
    accessibilityLabel={t('刷新会话')} disabled={loading} onPress={() => void load(true)} style={styles.navAction}>
    <Text style={styles.link}>{t('刷新')}</Text>
  </Pressable> : null}>
    {!online ? <><Hint>{t('请先连接服务器。')}</Hint><PrimaryButton label={t('连接服务器')} onPress={() => navigation.navigate('Connection')} /></> : <>
      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {bots.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityState={{ selected: bot.id === botId }}
            accessibilityLabel={t('查看智能体：{0}', { 0: bot.name })} onPress={() => setBotId(bot.id)}
            style={[styles.chip, bot.id === botId && styles.chipOn]}>
            <Text style={[styles.chipText, bot.id === botId && styles.chipTextOn]}>{bot.name}</Text>
          </Pressable>)}
        </ScrollView>
        <TextInput keyboardAppearance={scheme} value={query} onChangeText={setQuery} style={styles.search}
          accessibilityLabel={t('搜索已加载会话')} placeholder={t('搜索已加载会话')} placeholderTextColor={C.text2}
          autoCorrect={false} autoCapitalize="none" />
        <View style={styles.filters}>
          {([['all', t('全部')], ['scheduled', t('定时任务')], ['chat', t('应用会话')], ['other', t('其他来源')]] as const).map(([id, label]) =>
            <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: id === filter }}
              onPress={() => setFilter(id)} style={[styles.filter, id === filter && styles.filterOn]}>
              <Text style={[styles.chipText, id === filter && styles.chipTextOn]}>{label}</Text>
            </Pressable>)}
        </View>
        {loaded ? <Text style={styles.meta}>{t('已加载 {0} 个会话', { 0: rows.length })}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
      <FlatList data={visible} keyExtractor={row => `${row.bot}:${row.id}`} contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: row }) => <Pressable accessibilityRole="button" accessibilityLabel={t('查看会话：{0}', { 0: row.title || row.id })}
          onPress={() => navigation.navigate('SessionTranscript', { botId, sessionId: row.id, title: row.title || row.id })}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={2}>{row.title || row.id}</Text>
            <Text style={styles.meta} numberOfLines={2}>{[
              sourceLabel(row), t('{0} 条消息', { 0: row.messageCount }), row.archived ? t('已归档') : '',
            ].filter(Boolean).join(' · ')}</Text>
            {row.lastActive ? <Text style={styles.meta}>{new Date(row.lastActive * 1000).toLocaleString(localeTag())}</Text> : null}
          </View>
          <ChevronIcon size={11} color={C.text2} />
        </Pressable>}
        ListEmptyComponent={loaded && !loading ? <Text style={styles.empty}>{rows.length ? t('已加载会话中没有匹配项') : t('暂无会话记录')}</Text> : undefined}
        ListFooterComponent={<View style={styles.footer}>
          {loading ? <ActivityIndicator color={C.green} accessibilityLabel={t('加载中…')} /> : null}
          {!loading && (error || nextOffset !== null) ? <Pressable accessibilityRole="button" style={styles.more}
            onPress={() => void load(nextOffset === null)}><Text style={styles.link}>{error ? t('重试') : t('加载更多会话')}</Text></Pressable> : null}
        </View>} />
    </>}
  </Page>;
}

const useStyles = themedStyles(({ C }) => ({
  controls: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  chips: { gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.field },
  chipOn: { backgroundColor: C.selected, borderWidth: 1, borderColor: C.selectedBorder },
  chipText: { fontSize: 12, lineHeight: 17, color: C.text2 },
  chipTextOn: { color: C.green, fontWeight: '600' },
  search: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, color: C.text, backgroundColor: C.field, fontSize: 14 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  filter: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 10 },
  filterOn: { backgroundColor: C.selected },
  list: { padding: 16, paddingTop: 8, gap: 8, paddingBottom: 32 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: C.field, padding: 14 },
  flex: { flex: 1, minWidth: 0, gap: 5 },
  name: { color: C.text, fontSize: 15, lineHeight: 21 },
  meta: { color: C.text2, fontSize: 11, lineHeight: 17 },
  link: { color: C.green, fontSize: 13 },
  error: { color: C.red, fontSize: 12, lineHeight: 18 },
  navAction: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  footer: { paddingVertical: 12, alignItems: 'center' },
  more: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  empty: { color: C.text2, paddingVertical: 20, fontSize: 13, textAlign: 'center' },
  pressed: { opacity: 0.65 },
}), false);
