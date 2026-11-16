import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { CodexChat, CodexSupervisorStatus } from '../codexSupervisor';
import { t, useTranslation } from '../i18n';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { CodexChatPicker } from './CodexChatPicker';
import { PrimaryButton } from './UI';

/** Transient draft only. The explicit start action saves the watch on the host. */
export function SupervisorWatchPicker({ botId, onClose, onSaved }: {
  botId: string; onClose: () => void; onSaved: (status: CodexSupervisorStatus) => void;
}) {
  useTranslation();
  const { styles, C, scheme } = useStyles();
  const { connection, modelPicks, loadCodexStatus, startCodexWatch } = useStore();
  const [status, setStatus] = useState<CodexSupervisorStatus | null>(null);
  const [chat, setChat] = useState<CodexChat | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const acting = useRef(false);
  const reading = useRef(false);
  const edited = useRef(false);
  const connected = connection.status === 'connected';

  async function readStatus() {
    if (reading.current || !connected) return;
    const version = generation.current;
    reading.current = true; setLoading(true); setError('');
    try {
      const value = await loadCodexStatus();
      if (version !== generation.current) return;
      setStatus(value);
      if (!edited.current && value.spec) {
        setGoal(value.spec.goal);
        setChat({ id: value.spec.threadId, title: value.observed?.title || value.spec.threadId });
      }
    } catch (e) {
      if (version === generation.current) setError(e instanceof Error ? e.message : t('无法读取监督状态。'));
    } finally {
      if (version === generation.current) { reading.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    generation.current++; reading.current = false; acting.current = false; edited.current = false;
    setStatus(null); setChat(null); setGoal(''); setChoosing(true); setBusy(false); setError('');
    void readStatus();
    return () => { generation.current++; };
  }, [connection.url, connected, loadCodexStatus]);

  async function save() {
    if (acting.current || !connected || !status || !chat || !goal.trim() || !botId) return;
    const version = generation.current;
    acting.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    const saved = status.spec;
    const pick = modelPicks?.[botId];
    try {
      const result = await startCodexWatch({ threadId: chat.id, hostId: 'local', profile: botId, goal: goal.trim(),
        reviewEnabled: saved?.reviewEnabled ?? true,
        model: saved?.profile === botId ? saved.model || '' : pick?.model || '',
        provider: saved?.profile === botId ? saved.provider || '' : pick?.provider || '',
      });
      if (version === generation.current) onSaved(result);
    } catch (e) {
      if (version === generation.current) setError(e instanceof Error ? e.message : t('无法更新监督任务。'));
    } finally {
      if (version === generation.current) { acting.current = false; setBusy(false); }
    }
  }

  return <View style={styles.body}>
    <View style={styles.heading}>
      <Text style={styles.title}>{t('选择 Codex 会话')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('关闭')} disabled={busy} onPress={onClose} style={styles.action}>
        <Text style={styles.link}>{t('关闭')}</Text>
      </Pressable>
    </View>
    {choosing ? <CodexChatPicker value={chat?.id || ''} onSelect={value => {
      edited.current = true; setChat(value); setChoosing(false); Keyboard.dismiss();
    }} /> : <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets style={styles.form}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('重新选择会话')} disabled={busy} onPress={() => setChoosing(true)} style={styles.selected}>
        <Text style={styles.chatTitle} numberOfLines={2}>{chat?.title}</Text>
        <Text style={styles.link}>{t('重新选择会话')}</Text>
      </Pressable>
      <Text style={styles.label}>{t('目标与监督指令')}</Text>
      <TextInput accessibilityLabel={t('目标与监督指令')} value={goal} onChangeText={value => { edited.current = true; setGoal(value); }}
        multiline maxLength={8000} editable={!busy} keyboardAppearance={scheme} textAlignVertical="top" style={styles.input}
        placeholder={t('说明任务完成标准、要检查的问题和允许自动纠正的范围。')} placeholderTextColor={C.text2} />
      <PrimaryButton label={busy ? t('保存中…') : status?.enabled ? t('保存监督设置') : t('开始监督')}
        disabled={busy || !connected || !status || !chat || !goal.trim() || !botId} onPress={() => void save()} />
      <Text style={styles.caption}>{t('开始后，可自动向选定会话发送续做和纠偏指令，无需逐次确认。')}</Text>
    </ScrollView>}
    {loading ? <Text style={styles.caption}>{t('读取中')}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!status && !loading ? <Pressable accessibilityRole="button" onPress={() => void readStatus()} style={styles.action}>
      <Text style={styles.link}>{t('刷新监督状态')}</Text>
    </Pressable> : null}
  </View>;
}

const useStyles = themedStyles(({ C }) => ({
  body: { padding: 16, flexShrink: 1, gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: C.text, fontSize: 15, fontWeight: '600' },
  action: { minHeight: 44, justifyContent: 'center' },
  link: { color: C.text2, fontSize: 12 },
  form: { flexShrink: 1 },
  selected: { backgroundColor: C.field, borderRadius: 12, padding: 12, gap: 6 },
  chatTitle: { color: C.text, fontSize: 14 },
  label: { color: C.text2, fontSize: 12, marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: C.field, color: C.text, borderRadius: 12, padding: 12, fontSize: 14, minHeight: 100, maxHeight: 160, marginBottom: 12 },
  caption: { color: C.text3, fontSize: 11, lineHeight: 17, marginTop: 8 },
  error: { color: C.red, fontSize: 12 },
}), false);
