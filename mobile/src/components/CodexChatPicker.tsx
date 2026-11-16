import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { mergeCodexSidebar, orderCodexSidebar, type CodexChat, type CodexSidebar } from '../codexSupervisor';
import { t, useTranslation } from '../i18n';
import { useStore } from '../store';
import { themedStyles } from '../theme';

/** Only reads the desktop. Selecting a row does not start or change a watch. */
export function CodexChatPicker({ value, onSelect }: { value: string; onSelect: (chat: CodexChat) => void }) {
  useTranslation();
  const { styles, C, scheme } = useStyles();
  const { loadCodexChats, connection } = useStore();
  const [sidebar, setSidebar] = useState<CodexSidebar | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  async function read(cursor?: string) {
    if (pending.current || connection.status !== 'connected') return;
    const version = generation.current;
    pending.current = true; setLoading(true); setError('');
    try {
      const page = await loadCodexChats(cursor);
      if (version !== generation.current) return;
      const rows = Array.isArray(page) ? { threads: page, sections: [], projects: [] } : page;
      setSidebar(previous => cursor ? mergeCodexSidebar(previous, rows, true) : rows);
    } catch (e) {
      if (version === generation.current) setError(e instanceof Error ? e.message : t('无法读取 Codex 会话。'));
    } finally {
      if (version === generation.current) { pending.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    generation.current++; pending.current = false; setSidebar(null); setSearch(''); setOpen({});
    void read();
    return () => { generation.current++; pending.current = false; };
  }, [connection.url, connection.status, loadCodexChats]);
  const query = search.trim().toLocaleLowerCase();
  const groups = sidebar ? orderCodexSidebar(sidebar).map(group => ({ ...group, chats:
    !query || group.name.toLocaleLowerCase().includes(query) ? group.chats :
      group.chats.filter(chat => chat.title.toLocaleLowerCase().includes(query)),
  })).filter(group => !query || group.chats.length || group.name.toLocaleLowerCase().includes(query)) : [];
  return <View style={styles.root}>
    <View style={styles.searchRow}>
      <TextInput value={search} onChangeText={setSearch} placeholder={t('搜索项目或会话')} accessibilityLabel={t('搜索项目或会话')}
        placeholderTextColor={C.text2} keyboardAppearance={scheme} style={styles.search} autoCorrect={false} />
      <Pressable accessibilityRole="button" disabled={loading} onPress={() => void read()} style={styles.refresh}>
        <Text style={styles.meta}>{t('刷新')}</Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {sidebar?.historyUnavailable ? <Text style={styles.error}>{t('历史会话暂未读取，请刷新重试。')}</Text> : null}
    <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets nestedScrollEnabled>
      {groups.map(group => {
        const expanded = Boolean(query) || (open[group.id] ?? (group.kind !== 'project' || group.chats.some(chat => chat.id === value)));
        return <View key={group.id}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }} testID={`codex-group:${group.id}`}
            onPress={() => setOpen(previous => ({ ...previous, [group.id]: !expanded }))} style={styles.group}>
            <Text style={styles.groupName} numberOfLines={1}>{group.kind === 'project' ? group.name : t(group.name)}</Text>
            <Text style={styles.meta}>{group.chats.length}</Text><Text style={styles.meta}>{expanded ? '⌄' : '›'}</Text>
          </Pressable>
          {expanded ? group.chats.length ? group.chats.map(chat => <Pressable key={chat.id} testID={`codex-choice:${chat.id}`}
            accessibilityRole="radio" accessibilityState={{ selected: value === chat.id }} onPress={() => onSelect(chat)}
            style={[styles.chat, value === chat.id && styles.selected]}>
            <Text style={styles.title} numberOfLines={2}>{chat.title || chat.id}</Text>
            <Text style={styles.meta}>{value === chat.id ? '✓' : chat.status?.type === 'active' ? t('正在运行') : '›'}</Text>
          </Pressable>) : <Text style={styles.empty}>{t(sidebar?.nextCursor ? '加载更多以查看较早会话' : '暂无会话')}</Text> : null}
        </View>;
      })}
      {!groups.length && !loading && !error ? <Text style={styles.empty}>{t(query ? '未找到匹配的会话' : '电脑上暂无可用的 Codex 会话。')}</Text> : null}
      {sidebar?.nextCursor ? <Pressable accessibilityRole="button" disabled={loading} onPress={() => void read(sidebar.nextCursor!)} style={styles.more}>
        <Text style={styles.meta}>{t(loading ? '读取中' : '加载更多会话')}</Text>
      </Pressable> : loading ? <Text style={styles.empty}>{t('读取中')}</Text> : null}
      {query && sidebar?.nextCursor ? <Text style={styles.empty}>{t('搜索当前已加载的会话，可继续加载更多。')}</Text> : null}
    </ScrollView>
  </View>;
}

const useStyles = themedStyles(({ C }) => ({
  root: { flexShrink: 1, gap: 8 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, color: C.text, backgroundColor: C.field, borderRadius: 12, padding: 10, fontSize: 14 },
  refresh: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  list: { flexShrink: 1, maxHeight: 350 },
  group: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupName: { color: C.text, fontSize: 13, fontWeight: '600', flex: 1 },
  chat: { minHeight: 44, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10 },
  selected: { backgroundColor: C.selected },
  title: { color: C.text, fontSize: 13, flex: 1 },
  meta: { color: C.text2, fontSize: 12 },
  empty: { color: C.text2, fontSize: 12, paddingVertical: 10 },
  error: { color: C.red, fontSize: 12 },
  more: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
}), false);
