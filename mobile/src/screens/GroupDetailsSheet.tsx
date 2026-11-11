import { t, useTranslation } from "../i18n";
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Sheet } from '../components/Sheet';
import { Bloub, BloubGroup } from '../components/Bloub';
import { ChevronIcon, CloseIcon } from '../components/Icons';
import { ConfirmBlock, PrimaryButton } from '../components/UI';
import { useStore } from '../store';
import { themedStyles } from '../theme';

/**
 * What a group is: its members, each on its own session, and the two things
 * the round is allowed to make noise with — tapbacks and notifications.
 */
export function GroupDetailsSheet({
  visible,
  onClose,
  threadId,
  onLeave,
  onModel,
  onUpdated,
}: {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  onLeave: () => void;
  onModel: () => void;
  onUpdated?: (id: string) => void;
}) {
  const { styles, C, scheme } = useStyles();
  useTranslation();
  const { bots, threadById, botById, updateGroup, leaveGroup } = useStore();
  const afterClose = useRef<'model' | 'leave' | null>(null);
  const changing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<'name' | 'members' | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<
    { kind: 'leave' } | { kind: 'remove'; id: string; name: string } | null
  >(null);
  const thread = threadById(threadId);
  // Read once: the callbacks below run later, when the narrowing is gone.
  const memberIds = thread?.members ?? [];

  const members = memberIds.map((id) => botById(id)).filter(Boolean);
  const faces = members.map((bot) => ({ shape: bot!.shape, color: bot!.color }));
  useEffect(() => {
    if (!visible) { setEditing(null); setPending(null); setError(''); }
  }, [visible]);

  function edit(kind: 'name' | 'members') {
    setError(''); setName(thread?.name || ''); setSelected([...memberIds]); setEditing(kind);
  }

  async function save() {
    if (!editing || changing.current || (editing === 'name' ? !name.trim() : !selected.length)) return;
    changing.current = true; setBusy(true); setError('');
    try {
      const id = await updateGroup(threadId, editing === 'name' ? { name: name.trim() } : { members: selected });
      onUpdated?.(id); setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('操作失败，请重试。'));
    } finally { changing.current = false; setBusy(false); }
  }

  async function confirm() {
    if (!pending || changing.current) return;
    changing.current = true; setBusy(true); setError('');
    try {
      if (pending.kind === 'leave') {
        await leaveGroup(threadId);
        afterClose.current = 'leave'; onClose();
      } else {
        const id = await updateGroup(threadId, { members: memberIds.filter(id => id !== pending.id) });
        onUpdated?.(id);
        setPending(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('操作失败，请重试。'));
    } finally { changing.current = false; setBusy(false); }
  }

  return (
    <Sheet visible={visible} onClose={() => { if (!changing.current) onClose(); }} onDismiss={() => {
      const action = afterClose.current;
      afterClose.current = null;
      setPending(null);
      setError('');
      if (action === 'model') onModel();
      if (action === 'leave') onLeave();
    }}>
        <>
          <View style={styles.top}>
            <Pressable disabled={busy} style={styles.close} onPress={onClose} accessibilityLabel={t("关闭")}>
              <CloseIcon />
            </Pressable>
            <BloubGroup members={faces} size={58} />
            <Text style={styles.name}>{thread?.name ?? t("群组")}</Text>
            <Text style={styles.sub}>{thread?.subtitle ?? ''}</Text>
          </View>

          {pending ? (
            <ConfirmBlock
              title={
                pending.kind === 'leave' ? t("退出此群组？") : t("移除 {0}？", {"0": pending.name})
              }
              message={
                pending.kind === 'leave'
                  ? t("群组会话将被移除，每个智能体的独立会话仍会保留。")
                  : t("该智能体将退出群组，其独立会话和记忆仍会保留。")
              }
              confirmLabel={pending.kind === 'leave' ? t("退出") : t("移除")}
              busy={busy}
              error={error}
              onCancel={() => { if (!changing.current) { setPending(null); setError(''); } }}
              onConfirm={() => void confirm()}
            />
          ) : editing ? <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={styles.label}>{editing === 'name' ? t('群组名称') : t('成员')}</Text>
            {editing === 'name' ? <TextInput accessibilityLabel={t('群组名称')} value={name} onChangeText={setName}
              maxLength={80} editable={!busy} keyboardAppearance={scheme} placeholderTextColor={C.text2} style={styles.input} />
              : <View style={styles.card}>{bots.map((bot, index) => {
                const checked = selected.includes(bot.id);
                return <Pressable key={bot.id} accessibilityRole="checkbox" accessibilityLabel={bot.name}
                  accessibilityState={{ checked }} disabled={busy || (checked ? selected.length <= 1 : selected.length >= 20)}
                  onPress={() => setSelected(current => current.includes(bot.id) ? current.filter(id => id !== bot.id) : [...current, bot.id])}
                  style={[styles.row, index > 0 && styles.line]}>
                  <Bloub shape={bot.shape} color={bot.color} size={26} />
                  <Text style={[styles.rowName, styles.copy]}>{bot.name}</Text>
                  <Text style={styles.value}>{checked ? '✓' : ''}</Text>
                </Pressable>;
              })}</View>}
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            <View style={styles.actions}>
              <PrimaryButton tone="quiet" label={t('取消')} disabled={busy} onPress={() => { setEditing(null); setError(''); }} />
              <PrimaryButton label={busy ? t('保存中…') : t('保存更改')} disabled={busy || (editing === 'name' ? !name.trim() : !selected.length)} onPress={() => void save()} />
            </View>
          </ScrollView> : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <View style={styles.card}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('群组名称')} style={styles.row} onPress={() => edit('name')}>
                <Text style={[styles.rowName, styles.copy]}>{t('群组名称')}</Text>
                <Text style={styles.value} numberOfLines={1}>{thread?.name}</Text><ChevronIcon />
              </Pressable>
            </View>
            <Text style={styles.label}>{t("成员")}</Text>
            <View style={styles.card}>
              {members.map((bot, index) => (
                <Pressable
                  key={bot!.id}
                  accessibilityRole="button"
                  disabled={memberIds.length <= 1}
                  style={[styles.row, index > 0 && styles.line]}
                  onPress={() =>
                    setPending({ kind: 'remove', id: bot!.id, name: bot!.name })
                  }
                >
                  <Bloub shape={bot!.shape} color={bot!.color} size={26} />
                  <View style={styles.copy}>
                    <Text style={styles.rowName}>{bot!.name}</Text>
                    <Text style={styles.rowMeta}>
                      {bot!.tag || bot!.role}
                    </Text>
                  </View>
                  <ChevronIcon />
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" accessibilityLabel={t('添加成员')} style={[styles.row, styles.line]} onPress={() => edit('members')}>
                <Text style={[styles.rowName, styles.copy]}>{t('添加成员')}</Text><ChevronIcon />
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {t("每个成员独立回复，也可通过 @ 提及其他成员并交接任务。")}
            </Text>

            <Text style={styles.label}>{t("会话")}</Text>
            <View style={styles.card}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('选择模型')} style={styles.row}
                onPress={() => { afterClose.current = 'model'; onClose(); }}>
                <View style={styles.copy}>
                  <Text style={styles.rowName}>{t("模型")}</Text>
                </View>
                <Text style={styles.value}>{t('成员')}</Text>
                <ChevronIcon />
              </Pressable>
              <View style={[styles.row, styles.line]}>
                <View style={styles.copy}>
                  <Text style={styles.rowName}>{t("会话数")}</Text>
                </View>
                <Text style={styles.value}>{members.length} {t("个独立会话")}</Text>
              </View>
            </View>

            <Pressable style={styles.danger} onPress={() => setPending({ kind: 'leave' })}>
              <Text style={styles.dangerText}>{t("退出群组")}</Text>
            </Pressable>
          </ScrollView>
          )}
        </>
    </Sheet>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  top: { alignItems: 'center', paddingTop: 14, paddingHorizontal: 16 },
  close: {
    position: 'absolute',
    top: 12,
    right: 14,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: C.field2,
  },
  name: { marginTop: 8, color: C.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  sub: { marginTop: 3, color: INK.quiet, fontSize: 10 },

  body: { flexShrink: 1 },
  bodyContent: { paddingTop: 12, paddingHorizontal: 10, paddingBottom: 20 },
  label: {
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: 4,
    color: INK.label,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.04,
    textTransform: 'uppercase',
  },
  card: { overflow: 'hidden', borderRadius: 11, backgroundColor: C.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, paddingHorizontal: 10 },
  line: { borderTopWidth: 1, borderTopColor: C.hairline },
  copy: { flex: 1 },
  rowName: { color: C.text, fontSize: 12, fontWeight: '500' },
  rowMeta: { color: INK.quiet, fontSize: 9 },
  value: { color: INK.quiet, fontSize: 11 },
  hint: { marginTop: 7, color: INK.quiet, fontSize: 10, lineHeight: 14 },
  input: { color: C.text, backgroundColor: C.card, borderRadius: 11, padding: 12, fontSize: 13, minHeight: 44 },
  actions: { marginTop: 12, gap: 8 },
  error: { color: C.red, fontSize: 11, lineHeight: 16, marginTop: 8 },
  danger: {
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderRadius: 11,
    backgroundColor: C.card,
  },
  dangerText: { color: C.red, fontSize: 12, fontWeight: '500' },

}));
