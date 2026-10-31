import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { BridgeSession } from '../api';
import { localeTag, t, useTranslation } from '../i18n';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { ChevronIcon } from './Icons';

/** Application sessions from the bridge; scheduled runs remain in the task section. */
export function ConversationHistory({ botId, onOpen }: {
  botId: string; onOpen: (session: BridgeSession) => void;
}) {
  useTranslation();
  const { styles, C } = useStyles();
  const { loadSessions } = useStore();
  const [rows, setRows] = useState<BridgeSession[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);

  async function reload() {
    const ticket = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const sessions = await loadSessions(botId);
      if (ticket === revision.current) setRows(sessions);
    } catch {
      if (ticket === revision.current) setError(t('无法读取会话记录。'));
    } finally {
      if (ticket === revision.current) setLoading(false);
    }
  }
  useEffect(() => { void reload(); return () => { revision.current += 1; }; }, [botId]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.toolbar}>
        <Text style={styles.meta}>{t('应用会话')}</Text>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void reload()} style={styles.refresh}>
          <Text style={styles.link}>{t('刷新')}</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color={C.green} accessibilityLabel={t('加载中…')} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {rows?.length === 0 ? <Text style={styles.meta}>{t('暂无会话记录')}</Text> : null}
      {rows?.map(row => (
        <Pressable key={row.id} accessibilityRole="button"
          accessibilityLabel={t('查看会话：{0}', { 0: row.title || row.id })}
          onPress={() => onOpen(row)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={2}>{row.title || row.id}</Text>
            <Text style={styles.meta}>{[
              row.lastActive ? new Date(row.lastActive * 1000).toLocaleString(localeTag()) : '',
              t('{0} 条消息', { 0: row.messageCount }),
              row.archived ? t('已归档') : '',
            ].filter(Boolean).join(' · ')}</Text>
          </View>
          <ChevronIcon size={11} color={C.text2} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const useStyles = themedStyles(({ C }) => ({
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refresh: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  card: { backgroundColor: C.field, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0, gap: 6 },
  name: { fontSize: 15, lineHeight: 21, color: C.text },
  meta: { fontSize: 12, lineHeight: 18, color: C.text2 },
  link: { fontSize: 14, color: C.green },
  error: { fontSize: 13, color: C.red },
  pressed: { opacity: 0.65 },
}), false);
