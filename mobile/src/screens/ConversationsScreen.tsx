import { t, useTranslation } from "../i18n";
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bloub, BloubGroup } from '../components/Bloub';
import { PlusIcon, SearchIcon, SettingsIcon } from '../components/Icons';
import { FirstRunBody } from '../components/FirstRun';
import { SwipeRow } from '../components/SwipeRow';
import { Sheet } from '../components/Sheet';
import { ConfirmBlock, Row, SheetHeader } from '../components/UI';
import { NewAgentSheet } from './NewAgentSheet';
import type { Thread } from '../data';
import { useStore } from '../store';
import { useAppNavigation } from '../nav';
import { themedStyles } from '../theme';

type SectionState = Record<string, boolean>; // section name -> collapsed

/**
 * What a person opens the app on: the bots they keep close, and the
 * conversations that moved. A long press on a row is the way to pin it, to
 * mark it read, or to let it go.
 */
export function ConversationsScreen() {
  const { styles, C, INK, scheme } = useStyles();
  useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const { bots, threads, botById, prefs, connection, togglePin, markRead, markUnread, removeThread } =
    useStore();
  const [query, setQuery] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<Thread | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [collapsed, setCollapsed] = useState<SectionState>({});

  function closeMenu() {
    if (deleting) return;
    setMenu(null); setConfirmDelete(null); setDeleteError('');
  }

  const needle = query.trim().toLowerCase();

  // A pinned conversation is on the strip above: it is not said twice.
  const unpinned = useMemo(() => threads.filter((thread) => !thread.pinned), [threads]);
  const recent = useMemo(
    () =>
      needle
        ? unpinned.filter((thread) =>
            `${thread.name} ${thread.preview}`.toLowerCase().includes(needle),
          )
        : unpinned,
    [needle, unpinned],
  );
  const pinned = useMemo(
    () =>
      threads
        .filter((thread) => thread.pinned)
        .filter((thread) =>
          needle ? `${thread.name} ${thread.preview}`.toLowerCase().includes(needle) : true,
        ),
    [needle, threads],
  );

  // Group recent threads by section
  const sections = useMemo(() => {
    const grouped: Record<string, Thread[]> = {};
    const unsectioned: Thread[] = [];

    for (const thread of recent) {
      if (thread.section) {
        if (!grouped[thread.section]) grouped[thread.section] = [];
        grouped[thread.section].push(thread);
      } else {
        unsectioned.push(thread);
      }
    }

    return { grouped, unsectioned, names: Object.keys(grouped).sort() };
  }, [recent]);

  function toggleSection(name: string) {
    setCollapsed(prev => ({ ...prev, [name]: !prev[name] }));
  }

  function faceOf(thread: Thread, size = 38) {
    if (thread.kind === 'group') {
      const members = (thread.members ?? [])
        .map((id) => botById(id))
        .filter(Boolean)
        .map((bot) => ({ shape: bot!.shape, color: bot!.color }));
      return <BloubGroup members={members} size={size} active={thread.typing} />;
    }
    const bot = botById(thread.botId);
    return <Bloub shape={bot?.shape} color={bot?.color ?? '#8b5cf6'} size={size} active={thread.typing} />;
  }

  function open(thread: Thread) {
    if (!thread?.id) return;
    navigation.navigate('Chat', { threadId: thread.id });
  }

  async function changePin(threadId: string) {
    try { await togglePin(threadId); setMenu(null); }
    catch { Alert.alert(t('设置未保存，请重试。')); }
  }

  function toggleSearch() {
    if (searchExpanded && query) {
      setQuery('');
    }
    setSearchExpanded(!searchExpanded);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Pressable
          style={styles.round}
          accessibilityLabel={t("设置")}
          onPress={() => navigation.navigate('Settings')}
        >
          <SettingsIcon />
        </Pressable>
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.round, styles.headerAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t("搜索")}
            accessibilityState={{ expanded: searchExpanded }}
            onPress={toggleSearch}
          >
            <SearchIcon size={21} color={C.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.round, styles.headerAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t("新建智能体")}
            onPress={() => setCreating(true)}
          >
            <PlusIcon size={26} color={C.text} />
          </Pressable>
        </View>
      </View>
      {searchExpanded && (
        <View style={styles.searchBox}>
          <View style={styles.search}>
            <SearchIcon />
            <TextInput
              keyboardAppearance={scheme}
              value={query}
              onChangeText={setQuery}
              placeholder={t("搜索智能体")}
              placeholderTextColor={INK.meta}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
            />
          </View>
        </View>
      )}

      {bots.length === 0 ? (
        <FirstRunBody
          onCreate={() => setCreating(true)}
          onSetup={() => navigation.navigate('Setup')}
        />
      ) : (
        <>
      {pinned.length > 0 ? (
        <View style={styles.pinned}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pinnedGrid}>
            {pinned.map((thread) => (
              <Pressable
                key={thread.id}
                style={({ pressed }) => [styles.pinnedItem, pressed && styles.pressed]}
                onPress={() => open(thread)}
                onLongPress={() => setMenu(thread)}
                delayLongPress={260}
              >
                {faceOf(thread, 72)}
                <Text style={styles.pinnedName} numberOfLines={1}>
                  {thread.kind === 'group' ? thread.name : thread.name.split(' ')[0]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <ScrollView style={styles.recent} contentContainerStyle={styles.recentBody}>
        {sections.names.map((sectionName) => (
          <View key={sectionName} style={styles.section}>
            <Pressable
              style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}
              onPress={() => toggleSection(sectionName)}
            >
              <Text style={styles.sectionChevron}>{collapsed[sectionName] ? '›' : '⌄'}</Text>
              <Text style={styles.sectionName}>{sectionName}</Text>
              <Text style={styles.sectionCount}>{sections.grouped[sectionName].length}</Text>
            </Pressable>
            {!collapsed[sectionName] && sections.grouped[sectionName].map((thread) => (
              <SwipeRow
                key={thread.id}
                left={{
                  label: thread.pinned ? t("取消置顶") : t("置顶"),
                  glyph: '⌖',
                  onPress: () => void changePin(thread.id),
                }}
                right={{
                  label: thread.unread ? t("已读") : t("未读"),
                  glyph: thread.unread ? '✓' : '●',
                  onPress: () => (thread.unread ? markRead(thread.id) : markUnread(thread.id)),
                }}
              >
                <Pressable
                  style={({ pressed }) => [styles.thread, pressed && styles.pressed]}
                  onPress={() => open(thread)}
                  onLongPress={() => setMenu(thread)}
                  delayLongPress={260}
                >
                  <View style={styles.avatarWrap}>
                    {faceOf(thread)}
                    {thread.unread ? <View style={styles.unread} /> : null}
                  </View>
                  <View style={styles.threadCopy}>
                    <View style={styles.threadTop}>
                      <Text numberOfLines={1} style={{ flex: 1 }}>
                        <Text style={styles.threadName}>{thread.name}</Text>
                        {thread.tag ? <Text style={styles.threadTag}> {thread.tag}</Text> : null}
                      </Text>
                      <Text style={styles.threadTime}>{thread.time}</Text>
                    </View>
                    <Text
                      style={[styles.threadPreview, thread.unread && styles.threadPreviewUnread]}
                      numberOfLines={2}
                    >
                      {thread.preview}
                    </Text>
                  </View>
                </Pressable>
              </SwipeRow>
            ))}
          </View>
        ))}

        {sections.unsectioned.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionName}>{t("最近")}</Text>
              <Text style={styles.sectionCount}>{sections.unsectioned.length}</Text>
            </View>
            {sections.unsectioned.map((thread) => (
              <SwipeRow
                key={thread.id}
                left={{
                  label: thread.pinned ? t("取消置顶") : t("置顶"),
                  glyph: '⌖',
                  onPress: () => void changePin(thread.id),
                }}
                right={{
                  label: thread.unread ? t("已读") : t("未读"),
                  glyph: thread.unread ? '✓' : '●',
                  onPress: () => (thread.unread ? markRead(thread.id) : markUnread(thread.id)),
                }}
              >
                <Pressable
                  style={({ pressed }) => [styles.thread, pressed && styles.pressed]}
                  onPress={() => open(thread)}
                  onLongPress={() => setMenu(thread)}
                  delayLongPress={260}
                >
                  <View style={styles.avatarWrap}>
                    {faceOf(thread)}
                    {thread.unread ? <View style={styles.unread} /> : null}
                  </View>
                  <View style={styles.threadCopy}>
                    <View style={styles.threadTop}>
                      <Text numberOfLines={1} style={{ flex: 1 }}>
                        <Text style={styles.threadName}>{thread.name}</Text>
                        {thread.tag ? <Text style={styles.threadTag}> {thread.tag}</Text> : null}
                      </Text>
                      <Text style={styles.threadTime}>{thread.time}</Text>
                    </View>
                    <Text
                      style={[styles.threadPreview, thread.unread && styles.threadPreviewUnread]}
                      numberOfLines={2}
                    >
                      {thread.preview}
                    </Text>
                  </View>
                </Pressable>
              </SwipeRow>
            ))}
          </View>
        )}

        {recent.length === 0 ? (
          <Text style={styles.none}>
            {needle
              ? t("没有找到匹配的智能体。")
              : threads.length === 0
                ? t("暂无会话，点击加号创建第一个会话。")
                : t("所有会话均已置顶。")}
          </Text>
        ) : null}
      </ScrollView>
        </>
      )}

      <NewAgentSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(threadId) => {
          setCreating(false);
          navigation.navigate('Chat', { threadId });
        }}
      />

      <Sheet
        visible={menu !== null}
        onClose={closeMenu}
      >
        {menu && confirmDelete ? (
          <ConfirmBlock
            title={menu.kind === 'bot' ? t('清空此会话？') : t("删除 {0}？", {"0": menu.name})}
            message={t("将删除该会话，智能体及其记忆仍会保留。")}
            confirmLabel={menu.kind === 'bot' ? t('清空') : t("删除")}
            busy={deleting} error={deleteError}
            onCancel={() => { if (!deleting) { setConfirmDelete(null); setDeleteError(''); } }}
            onConfirm={() => {
              if (deleting) return;
              setDeleting(true); setDeleteError('');
              void removeThread(menu.id).then(() => { setConfirmDelete(null); setMenu(null); })
                .catch(error => setDeleteError(error instanceof Error ? error.message : t('无法删除服务器会话。')))
                .finally(() => setDeleting(false));
            }}
          />
        ) : menu ? (
          <>
            <SheetHeader
              title={menu.name}
              sub={menu.kind === 'group' ? menu.subtitle : t("一个智能体，一个会话")}
              onClose={() => setMenu(null)}
            />
            <View style={styles.menuBody}>
              <View style={styles.menuCard}>
                <Row
                  name={menu.pinned ? t("取消置顶") : t("置顶会话")}
                  chevron={false}
                  onPress={() => {
                    void changePin(menu.id);
                  }}
                />
                <View style={styles.menuLine} />
                <Row
                  name={menu.unread ? t("标为已读") : t("标为未读")}
                  chevron={false}
                  onPress={() => {
                    if (menu.unread) markRead(menu.id);
                    else markUnread(menu.id);
                    setMenu(null);
                  }}
                />
                <View style={styles.menuLine} />
                <Row
                  name={t("打开")}
                  chevron={false}
                  onPress={() => {
                    const target = menu;
                    setMenu(null);
                    open(target);
                  }}
                />
                <View style={styles.menuLine} />
                <Row name={menu.kind === 'bot' ? t('清除对话') : t("删除")} chevron={false}
                  onPress={() => { setDeleteError(''); setConfirmDelete(menu); }} />
              </View>
            </View>
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  root: { flex: 1, backgroundColor: C.sidebar },
  head: { paddingHorizontal: 16, paddingBottom: 11 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flexShrink: 1,
    color: C.text,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    lineHeight: 23,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  round: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 20,
    backgroundColor: C.field,
  },
  headerAction: {
    borderWidth: 0.75,
    borderColor: C.border,
    backgroundColor: `${C.cardRaised}b3`,
  },
  searchBox: { paddingHorizontal: 16 },
  search: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.field,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 12, padding: 0 },

  pinned: { paddingHorizontal: 9, paddingTop: 17, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.divider },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  sectionText: {
    color: INK.quiet,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  sectionCount: { color: INK.quiet, fontSize: 10 },
  pinnedGrid: { flexDirection: 'row', gap: 12, paddingHorizontal: 7 },
  pinnedItem: { width: 76, flexShrink: 0, alignItems: 'center', gap: 5, paddingVertical: 4 },
  pressed: { opacity: 0.6 },
  pinnedName: { color: INK.quiet, fontSize: 10, fontWeight: '500', textAlign: 'center' },

  recent: { flex: 1 },
  section: { marginBottom: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 6,
  },
  sectionHeaderPressed: { opacity: 0.6 },
  sectionChevron: { color: INK.quiet, fontSize: 14, fontWeight: '600', width: 16 },
  sectionName: {
    flex: 1,
    color: INK.quiet,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  recentBody: { paddingHorizontal: 7, paddingTop: 12 },
  thread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 11,
  },
  avatarWrap: { width: 38, height: 38 },
  unread: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 9,
    height: 9,
    borderWidth: 2,
    borderColor: C.sidebar,
    borderRadius: 6,
    backgroundColor: C.blue,
  },
  threadCopy: { flex: 1, gap: 1 },
  threadTop: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  threadName: { flex: 1, color: INK.title, fontSize: 13.5, fontWeight: '600', letterSpacing: -0.19 },
    threadTag: { color: INK.meta, fontSize: 11.5, fontWeight: '400', letterSpacing: -0.1 },
  threadTime: { color: INK.meta, fontSize: 10 },
  threadPreview: { color: INK.quiet, fontSize: 11, lineHeight: 14.5 },
  threadPreviewUnread: { color: INK.quiet },
  none: { color: INK.quiet, fontSize: 12, padding: 12 },

  menuBody: { paddingTop: 14, paddingHorizontal: 12 },
  menuCard: { borderRadius: 13, backgroundColor: C.cardRaised, overflow: 'hidden' },
  menuLine: { height: 1, backgroundColor: C.hairline },
}));
