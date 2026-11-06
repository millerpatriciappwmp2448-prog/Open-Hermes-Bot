import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bloub } from '../components/Bloub';
import { DescriptionEditor, JobsPage } from '../components/BotAutomation';
import { BackIcon, ChevronIcon, ExportIcon } from '../components/Icons';
import { Sheet } from '../components/Sheet';
import { ConfirmBlock } from '../components/UI';
import { t, useTranslation } from '../i18n';
import type { RootStackParamList } from '../nav';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { notificationAccess, type NotificationAccess } from '../notificationDevice';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatSettings'>;

export function ChatSettingsScreen({ route, navigation }: Props) {
  useTranslation();
  const { styles, C, scheme } = useStyles();
  const insets = useSafeAreaInsets();
  const { threadById, botById, messages, togglePin, clearThread, removeBot, connection, updateBot, setBotPermissions, autoTagBot } = useStore();
  const { chatPreferences, saveChatPreferences } = useStore();
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState('');
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permissionsError, setPermissionsError] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const [access, setAccess] = useState<NotificationAccess>('undetermined');
  const [requesting, setRequesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [jobsOpen, setJobsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirming, setConfirming] = useState<'clear' | 'delete' | null>(null);
  const afterDismiss = useRef<'back' | 'home' | null>(null);
  const [exportError, setExportError] = useState('');
  const thread = threadById(route.params.threadId);
  const bot = thread ? botById(thread.botId) : undefined;
  const serverBot = Boolean(thread?.id.startsWith('bot:'));
  const online = connection.status === 'connected';
  const closeConfirm = () => { if (!deleting) { setConfirming(null); setDeleteError(''); } };
  const tapbacks = thread ? chatPreferences[thread.botId]?.tapbacks !== false : true;
  const notifications = thread ? chatPreferences[thread.botId]?.notifications !== false : true;
  const readAloud = thread ? chatPreferences[thread.botId]?.readAloud === true : false;
  const crossSpace = bot?.permissions?.crossSpace === true;
  const manageCreated = bot?.permissions?.manageCreated === true;
  const tagValue = tagDraft ?? bot?.tag ?? thread?.tag ?? '';

  async function saveTag() {
    if (!thread || tagDraft === null || tagBusy) return;
    const wanted = tagDraft.trim();
    if (wanted === (bot?.tag ?? thread.tag ?? '')) { setTagDraft(null); return; }
    setTagBusy(true); setTagError('');
    try { await updateBot(thread.botId, { tag: wanted }); setTagDraft(null); }
    catch { setTagError(t('设置未保存，请重试。')); }
    finally { setTagBusy(false); }
  }

  async function generateTag() {
    if (!thread || tagBusy) return;
    setTagBusy(true); setTagError('');
    try { await autoTagBot(thread.botId); setTagDraft(null); }
    catch (error) { setTagError(error instanceof Error && error.message ? error.message : t('操作失败，请重试。')); }
    finally { setTagBusy(false); }
  }

  async function changePermission(key: 'crossSpace' | 'manageCreated', value: boolean) {
    if (!thread || savingPermissions) return;
    setSavingPermissions(true); setPermissionsError('');
    try { await setBotPermissions(thread.botId, { [key]: value }); }
    catch { setPermissionsError(t('设置未保存，请重试。')); }
    finally { setSavingPermissions(false); }
  }

  useEffect(() => {
    let mounted = true;
    const update = () => { void notificationAccess().then(value => { if (mounted) setAccess(value); }); };
    update();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  async function changePin() {
    if (!thread || savingPreferences) return;
    setSavingPreferences(true);
    setPreferencesError('');
    try { await togglePin(thread.id); }
    catch { setPreferencesError(t('设置未保存，请重试。')); }
    finally { setSavingPreferences(false); }
  }

  async function changePreference(key: 'tapbacks' | 'notifications' | 'readAloud', value: boolean) {
    if (!thread || savingPreferences) return;
    setSavingPreferences(true);
    setPreferencesError('');
    try { await saveChatPreferences(thread.botId, { [key]: value }); }
    catch { setPreferencesError(t('设置未保存，请重试。')); }
    finally { setSavingPreferences(false); }
  }

  async function allowNotifications() {
    if (requesting) return;
    setRequesting(true);
    try {
      if (access === 'denied') await Linking.openSettings();
      else setAccess(await notificationAccess(true));
    } catch { setAccess('unavailable'); }
    finally { setRequesting(false); }
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
            {serverBot && !online ? <Text accessibilityRole="alert" style={styles.offlineNote}>{t('无法连接服务器')}</Text> : null}

            {thread.kind === 'bot' ? (
              <View style={styles.section}>
                <Text style={styles.label}>{t('标签')}</Text>
                <View style={[styles.card, styles.row]}>
                  <TextInput value={tagValue} onChangeText={value => setTagDraft(value.slice(0, 24))}
                    onBlur={() => void saveTag()} onSubmitEditing={() => void saveTag()} returnKeyType="done"
                    editable={!tagBusy && (!serverBot || online)} placeholder={t('添加标签')} placeholderTextColor={C.text2}
                    keyboardAppearance={scheme}
                    accessibilityLabel={t('标签')} style={[styles.rowText, styles.flex, styles.input]} />
                  <Pressable accessibilityRole="button" disabled={tagBusy || !serverBot || !online}
                    onPress={() => void generateTag()} hitSlop={8}>
                    <Text style={[styles.link, (tagBusy || !serverBot || !online) && styles.meta]}>{tagBusy ? t('生成中…') : t('自动生成')}</Text>
                  </Pressable>
                </View>
                {tagError ? <Text accessibilityRole="alert" style={styles.dangerSmall}>{tagError}</Text> : null}
              </View>
            ) : null}

            {thread.kind === 'bot' ? (
              <View style={styles.section}>
                <Text style={styles.label}>{t('描述')}</Text>
                <DescriptionEditor key={thread.botId} botId={thread.botId} embedded />
              </View>
            ) : null}

            <Pressable accessibilityRole="button" accessibilityLabel={t('高级')} accessibilityState={{ expanded: advancedOpen }}
              onPress={() => setAdvancedOpen(value => !value)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <Text style={[styles.label, styles.flex]}>{t('高级')}</Text>
              <View style={advancedOpen ? styles.expanded : undefined}><ChevronIcon size={11} color={C.text2} /></View>
            </Pressable>

            {advancedOpen ? <>
            <View style={styles.section}>
              <Text style={styles.label}>{t('模型')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('选择模型')}
                onPress={() => navigation.navigate('ChatModel', { threadId: thread.id })}
                style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}>
                <Text style={[styles.rowText, styles.flex]} numberOfLines={2}>{thread.threadModel || t('跟随服务器')}</Text>
                <ChevronIcon size={11} color={C.text2} />
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>{t('语音')}</Text>
              <View style={[styles.card, styles.row]}>
                <Text style={[styles.rowText, styles.flex]}>{t('朗读回复')}</Text>
                <Switch accessibilityLabel={t('朗读回复')} value={readAloud}
                  disabled={savingPreferences || (serverBot && !online)} onValueChange={value => void changePreference('readAloud', value)}
                  trackColor={{ false: C.field2, true: C.green }} ios_backgroundColor={C.field2} />
              </View>
            </View>

            {thread.kind === 'bot' ? <>
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
                {jobsOpen && online ? <JobsPage key={thread.botId} botId={thread.botId}
                  onOpenRun={run => navigation.navigate('SessionTranscript', { botId: thread.botId, sessionId: run.id, title: run.title })} embedded /> : null}
              </View>
            </> : null}

            {thread.kind === 'bot' ? (
              <View style={styles.section}>
                <Text style={styles.label}>{t('权限')}</Text>
                <View style={styles.card}>
                  <View style={[styles.row]}>
                    <Text style={[styles.rowText, styles.flex]}>{t('允许跨空间智能体通信')}</Text>
                    <Switch
                      accessibilityLabel={t('允许跨空间智能体通信')}
                      value={crossSpace}
                      disabled={savingPermissions || !serverBot || !online}
                      onValueChange={value => void changePermission('crossSpace', value)}
                      trackColor={{ false: C.field2, true: C.green }}
                      ios_backgroundColor={C.field2}
                    />
                  </View>
                  <View style={styles.divider} />
                  <View style={[styles.row]}>
                    <Text style={[styles.rowText, styles.flex]}>{t('管理它创建的智能体')}</Text>
                    <Switch
                      accessibilityLabel={t('管理它创建的智能体')}
                      value={manageCreated}
                      disabled={savingPermissions || !serverBot || !online}
                      onValueChange={value => void changePermission('manageCreated', value)}
                      trackColor={{ false: C.field2, true: C.green }}
                      ios_backgroundColor={C.field2}
                    />
                  </View>
                </View>
                {permissionsError ? <Text accessibilityRole="alert" style={styles.dangerSmall}>{permissionsError}</Text>
                  : <Text style={styles.meta}>{t('新对话生效')}</Text>}
              </View>
            ) : null}
            </> : null}

            <View style={styles.section}>
              <Text style={styles.label}>{t('会话')}</Text>
              {serverBot ? <Pressable accessibilityRole="button" accessibilityLabel={t('会话记录')}
                disabled={!online} onPress={() => navigation.navigate('SessionHistory', { botId: thread.botId })}
                style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}>
                <Text style={[styles.rowText, styles.flex]}>{t('会话记录')}</Text>
                <ChevronIcon size={11} color={C.text2} />
              </Pressable> : null}
              <View style={[styles.card, styles.row]}>
                <Text style={[styles.rowText, styles.flex]}>{t('已置顶')}</Text>
                <Switch accessibilityLabel={t('已置顶')} value={Boolean(thread.pinned)} disabled={savingPreferences}
                  onValueChange={() => void changePin()}
                  trackColor={{ false: C.field2, true: C.green }} ios_backgroundColor={C.field2} />
              </View>
              <View style={[styles.card, styles.row]}>
                <Text style={[styles.rowText, styles.flex]}>{t('表情回应')}</Text>
                <Switch accessibilityLabel={t('表情回应')} value={tapbacks}
                  disabled={savingPreferences || (serverBot && !online)} onValueChange={value => void changePreference('tapbacks', value)}
                  trackColor={{ false: C.field2, true: C.green }} ios_backgroundColor={C.field2} />
              </View>
              <View style={[styles.card, styles.row]}>
                <Text style={[styles.rowText, styles.flex]}>{t('通知')}</Text>
                <Switch accessibilityLabel={t('通知')} value={notifications}
                  disabled={savingPreferences || (serverBot && !online)} onValueChange={value => void changePreference('notifications', value)}
                  trackColor={{ false: C.field2, true: C.green }} ios_backgroundColor={C.field2} />
              </View>
              {notifications && access !== 'allowed' ? <View style={styles.notificationAccess}>
                <Text style={[styles.meta, styles.flex]}>{access === 'denied' ? t('系统通知已关闭')
                  : access === 'unsupported' ? t('请在手机上授权通知') : access === 'unavailable' ? t('无法读取通知权限') : t('尚未授权系统通知')}</Text>
                {access !== 'unsupported' ? <Pressable accessibilityRole="button" disabled={requesting}
                  onPress={() => void allowNotifications()} hitSlop={8}>
                  <Text style={styles.link}>{access === 'denied' ? t('打开系统设置') : t('允许通知')}</Text>
                </Pressable> : null}
              </View> : null}
            </View>
            {preferencesError ? <Text accessibilityRole="alert" style={styles.danger}>{preferencesError}</Text> : null}
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
        <Sheet visible={confirming !== null} onClose={closeConfirm} onDismiss={() => {
          const destination = afterDismiss.current;
          afterDismiss.current = null;
          if (destination === 'back') navigation.goBack();
          if (destination === 'home') navigation.popToTop();
        }}>
          {thread ? <ConfirmBlock title={confirming === 'clear' ? t('清空此会话？') : t('删除此智能体？')}
            message={confirming === 'clear'
              ? t('将删除该会话，智能体及其记忆仍会保留。')
              : serverBot ? t('将移除该智能体及其会话，服务器会保留配置备份。其他智能体不受影响。') : t('将移除该演示智能体及其会话。')}
            confirmLabel={confirming === 'clear' ? t('清空') : t('删除')} onCancel={closeConfirm}
            busy={deleting} error={deleteError}
            onConfirm={() => {
              if (deleting) return;
              setDeleting(true); setDeleteError('');
              const clearing = confirming === 'clear';
              void (clearing ? clearThread(thread.id) : removeBot(thread.botId))
                .then(() => { afterDismiss.current = clearing ? 'back' : 'home'; setConfirming(null); })
                .catch(error => setDeleteError(error instanceof Error ? error.message : t('操作失败，请重试。')))
                .finally(() => setDeleting(false));
            }} /> : null}
        </Sheet>
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
  offlineNote: { color: C.red, fontSize: 13, lineHeight: 18, paddingHorizontal: 2 },
  input: { paddingVertical: 0 },
  dangerSmall: { color: C.red, fontSize: 12, lineHeight: 18, paddingHorizontal: 2 },
  expanded: { transform: [{ rotate: '90deg' }] },
  divider: { height: 1, backgroundColor: C.hairline, marginHorizontal: 16 },
  notificationAccess: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 },
  link: { color: C.green, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  danger: { color: C.red, fontSize: 15, lineHeight: 21 },
  pressed: { opacity: 0.65 },
}), false);
