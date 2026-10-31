import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bloub } from '../components/Bloub';
import { DescriptionEditor, JobsPage, RunTranscript } from '../components/BotAutomation';
import { ConversationHistory } from '../components/ConversationHistory';
import { BackIcon, ChevronIcon, ExportIcon } from '../components/Icons';
import { Sheet } from '../components/Sheet';
import { ConfirmBlock, SheetHeader } from '../components/UI';
import { t, useTranslation } from '../i18n';
import type { RootStackParamList } from '../nav';
import { useStore } from '../store';
import { themedStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatSettings'>;

export function ChatSettingsScreen({ route, navigation }: Props) {
  useTranslation();
  const { styles, C } = useStyles();
  const insets = useSafeAreaInsets();
  const { threadById, botById, messages, togglePin, clearThread, removeBot, connection } = useStore();
  const { chatPreferences, saveChatPreferences } = useStore();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [session, setSession] = useState<{ id: string; title: string } | null>(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [jobsOpen, setJobsOpen] = useState(false);
  const [run, setRun] = useState<{ id: string; title: string } | null>(null);
  const [confirming, setConfirming] = useState<'clear' | 'delete' | null>(null);
  const [exportError, setExportError] = useState('');
  const thread = threadById(route.params.threadId);
  const bot = thread ? botById(thread.botId) : undefined;
  const serverBot = Boolean(thread?.id.startsWith('bot:'));
  const online = connection.status === 'connected';
  const closeRun = () => setRun(null);
  const closeConfirm = () => { if (!deleting) { setConfirming(null); setDeleteError(''); } };
  const tapbacks = thread ? chatPreferences[thread.botId]?.tapbacks !== false : true;

  async function changeTapbacks(value: boolean) {
    if (!thread || savingPreferences) return;
    setSavingPreferences(true);
    setPreferencesError('');
    try { await saveChatPreferences(thread.botId, { tapbacks: value }); }
    catch { setPreferencesError(t('设置未保存，请重试。')); }
    finally { setSavingPreferences(false); }
  }

  async function exportChat() {
    if (!thread) return;
    setExportError('');
    const transcript = (messages[thread.id] ?? []).map(message => {
      const name = message.from === 'user' ? t('我') : botById(message.from)?.name ?? thread.name;
      return `${name}\n${message.text || message.attachment?.name || t('语音消息')}`;
    }).join('\n\n');
    try { await Share.share({ title: thread.name, message: `${thread.name}\n\n${transcript}` }); }
    catch { setExportError(t('无法导出，请重试。')); }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.nav}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('返回')} onPress={() => navigation.goBack()} style={styles.navButton}>
            <BackIcon size={17} color={C.text} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>{t('聊天设置')}</Text>
          <View style={styles.navButton} />
        </View>
        {!thread ? <Text style={styles.missing}>{t('此会话已不存在')}</Text> : (
          <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive"
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={styles.identity}>
              <Bloub shape={bot?.shape} color={bot?.color ?? C.green} size={40} />
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={2}>{thread.name}</Text>
                <Text style={styles.meta}>{serverBot ? t('Hermes 服务器') : t('演示模式')}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>{t('模型')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('选择模型')}
                onPress={() => navigation.navigate('ChatModel', { threadId: thread.id })}
                style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}>
                <Text style={[styles.rowText, styles.flex]} numberOfLines={2}>{thread.threadModel || t('跟随服务器')}</Text>
                <ChevronIcon size={11} color={C.text2} />
              </Pressable>
              {serverBot && !online ? <Text style={styles.meta}>{t('请先连接服务器。')}</Text> : null}
            </View>

            {thread.kind === 'bot' ? <>
              <View style={styles.section}>
                <Text style={styles.label}>{t('描述')}</Text>
                <DescriptionEditor key={thread.botId} botId={thread.botId} embedded />
              </View>
              <View style={styles.section}>
                <Text style={styles.label}>{t('定时任务')}</Text>
                <View style={styles.card}>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('查看定时任务')}
                    accessibilityState={{ expanded: jobsOpen, disabled: serverBot && !online }} disabled={serverBot && !online}
                    onPress={() => serverBot ? setJobsOpen(value => !value) : navigation.navigate('Connection')} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <View style={styles.flex}>
                      <Text style={styles.rowText}>{t('任务与运行记录')}</Text>
                    </View>
                    <View style={jobsOpen ? styles.expanded : undefined}><ChevronIcon size={11} color={C.text2} /></View>
                  </Pressable>
                </View>
                {jobsOpen && online ? <JobsPage key={thread.botId} botId={thread.botId} onOpenRun={setRun} embedded /> : null}
              </View>
            </> : null}

            <View style={styles.section}>
              <Text style={styles.label}>{t('会话')}</Text>
              {serverBot ? <Pressable accessibilityRole="button" accessibilityLabel={t('会话记录')}
                disabled={!online} onPress={() => setHistoryOpen(true)}
                style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}>
                <Text style={[styles.rowText, styles.flex]}>{t('会话记录')}</Text>
                <ChevronIcon size={11} color={C.text2} />
              </Pressable> : null}
              <View style={[styles.card, styles.row]}>
                <Text style={[styles.rowText, styles.flex]}>{t('已置顶')}</Text>
                <Switch accessibilityLabel={t('已置顶')} value={Boolean(thread.pinned)} onValueChange={() => togglePin(thread.id)}
                  trackColor={{ false: C.field2, true: C.green }} ios_backgroundColor={C.field2} />
              </View>
              <View style={[styles.card, styles.row]}>
                <Text style={[styles.rowText, styles.flex]}>{t('表情回应')}</Text>
                <Switch accessibilityLabel={t('表情回应')} value={tapbacks}
                  disabled={savingPreferences || (serverBot && !online)} onValueChange={value => void changeTapbacks(value)}
                  trackColor={{ false: C.field2, true: C.green }} ios_backgroundColor={C.field2} />
              </View>
              {preferencesError ? <Text accessibilityRole="alert" style={styles.danger}>{preferencesError}</Text> : null}
              <View style={[styles.card, styles.row]}>
                <View style={styles.flex}>
                  <Text style={styles.rowText}>{t('通知')}</Text>
                  <Text style={styles.meta}>{t('未接入系统推送')}</Text>
                </View>
                <Switch accessibilityLabel={t('通知')} value={false} disabled
                  trackColor={{ false: C.field2, true: C.green }} ios_backgroundColor={C.field2} />
              </View>
            </View>
            <View style={styles.section}>
              <View style={styles.card}>
                <Pressable accessibilityRole="button" onPress={() => void exportChat()}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <Text style={[styles.rowText, styles.flex]}>{t('导出对话')}</Text><ExportIcon size={15} color={C.text2} />
                </Pressable>
                <View style={styles.divider} />
                <Pressable accessibilityRole="button" onPress={() => setConfirming('clear')}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <Text style={[styles.rowText, styles.danger]}>{t('清除对话')}</Text>
                </Pressable>
                {thread.kind === 'bot' ? <><View style={styles.divider} />
                <Pressable accessibilityRole="button" disabled={Boolean(bot?.primary) || (serverBot && !online)} onPress={() => { setDeleteError(''); setConfirming('delete'); }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <Text style={[styles.rowText, bot?.primary ? styles.meta : styles.danger]}>{bot?.primary ? t('主智能体不能删除。') : t('删除智能体')}</Text>
                </Pressable></> : null}
              </View>
              {exportError ? <Text accessibilityRole="alert" style={styles.danger}>{exportError}</Text> : null}
            </View>
          </ScrollView>
        )}
      </View>
      {thread ? <>
        <Sheet visible={historyOpen} onClose={() => { setHistoryOpen(false); setSession(null); }}>
          <SheetHeader title={session?.title || t('会话记录')}
            onClose={() => { setHistoryOpen(false); setSession(null); }}
            back={session ? () => setSession(null) : undefined} />
          {session ? <RunTranscript key={session.id} botId={thread.botId} runId={session.id} kind="session" /> :
            historyOpen ? <ConversationHistory botId={thread.botId} onOpen={setSession} /> : null}
        </Sheet>
        <Sheet visible={run !== null} onClose={closeRun}>
          <SheetHeader title={run?.title ?? t('运行记录')} sub={t('运行记录')} onClose={closeRun} />
          {run ? <RunTranscript key={run.id} botId={thread.botId} runId={run.id} /> : null}
        </Sheet>
        <Sheet visible={confirming !== null} onClose={closeConfirm}>
          <ConfirmBlock title={confirming === 'clear' ? t('清空此会话？') : t('删除此智能体？')}
            message={confirming === 'clear'
              ? online ? t('将清空本机显示的消息，下一条消息会开启新的服务器会话；智能体的记忆仍保留在服务器上。') : t('将清空当前显示的消息。')
              : serverBot ? t('将移除该智能体及其会话，服务器会保留配置备份。其他智能体不受影响。') : t('将移除该演示智能体及其会话。')}
            confirmLabel={confirming === 'clear' ? t('清空') : t('删除')} onCancel={closeConfirm}
            busy={deleting} error={deleteError}
            onConfirm={() => {
              if (confirming === 'clear') { clearThread(thread.id); closeConfirm(); navigation.goBack(); }
              else if (!deleting) {
                setDeleting(true); setDeleteError('');
                void removeBot(thread.botId).then(() => { setConfirming(null); navigation.popToTop(); })
                  .catch(error => setDeleteError(error instanceof Error ? error.message : t('无法删除智能体。')))
                  .finally(() => setDeleting(false));
              }
            }} />
        </Sheet>
      </> : null}
    </KeyboardAvoidingView>
  );
}

const useStyles = themedStyles(({ C }) => ({
  root: { flex: 1, backgroundColor: C.bg },
  nav: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text },
  body: { paddingHorizontal: 20, paddingTop: 12, gap: 20 },
  missing: { padding: 24, color: C.text2, fontSize: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  name: { color: C.text, fontSize: 17, lineHeight: 23, fontWeight: '600', marginBottom: 4 },
  flex: { flex: 1, minWidth: 0 },
  section: { gap: 10 },
  label: { color: C.text2, fontSize: 14, lineHeight: 20, paddingHorizontal: 2 },
  card: { backgroundColor: C.field, borderRadius: 16, overflow: 'hidden' },
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { color: C.text, fontSize: 15, lineHeight: 21 },
  meta: { color: C.text2, fontSize: 12, lineHeight: 18 },
  offline: { padding: 16, gap: 10 },
  expanded: { transform: [{ rotate: '90deg' }] },
  divider: { height: 1, backgroundColor: C.hairline, marginHorizontal: 16 },
  danger: { color: C.red, fontSize: 15, lineHeight: 21 },
  pressed: { opacity: 0.65 },
}), false);
