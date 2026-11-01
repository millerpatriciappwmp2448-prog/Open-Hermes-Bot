import { t, useTranslation } from "../i18n";
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Sheet } from '../components/Sheet';
import { Bloub } from '../components/Bloub';
import { ConfirmBlock, PrimaryButton, Field, SectionLabel, SheetHeader } from '../components/UI';
import { COLORS, SHAPES } from '../data';
import type { BloubShape } from '../bloubFrames';
import { useStore } from '../store';
import { themedStyles } from '../theme';

/**
 * One bot, as the host keeps it: a name, a shape, a colour — and the two
 * things a hand can do with it here: open its conversation, or let it go.
 */
export function BotSheet({
  visible,
  onClose,
  botId,
  onOpen,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  botId: string | null;
  onOpen: (threadId: string) => void;
  onDeleted: () => void;
}) {
  const { styles } = useStyles();
  useTranslation();
  const { botById, threads, updateBot, removeBot } = useStore();
  const bot = botId ? botById(botId) : undefined;
  const [name, setName] = useState(bot?.name ?? '');
  const [shape, setShape] = useState<BloubShape>(bot?.shape ?? 'cercle');
  const [color, setColor] = useState(bot?.color ?? COLORS[0]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const busy = saving || deleting;

  // A different bot is a different face: the sheet is reused, the fields are not.
  useEffect(() => {
    if (!bot || !visible) return;
    setName(bot.name);
    setShape(bot.shape);
    setColor(bot.color);
    // A question asked about another bot is not asked about this one.
    setConfirming(false);
    setDeleteError('');
    setSaveError('');
  }, [bot?.id, visible]);

  if (!bot) return null;

  const thread = threads.find((entry) => entry.kind === 'bot' && entry.botId === bot.id);

  async function save() {
    if (busy) return;
    setSaving(true); setSaveError('');
    try {
      await updateBot(bot!.id, { name: name.trim() || bot!.name, shape, color });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('无法保存智能体。'));
    } finally { setSaving(false); }
  }

  return (
    <Sheet visible={visible} onClose={() => { if (!busy) onClose(); }}>
      <SheetHeader
        title={bot.name}
        sub={t("{0} · 会话 {1}", {"0": bot.role, "1": bot.session})}
        onClose={() => { if (!busy) onClose(); }}
      />

      {confirming ? (
        <ConfirmBlock
          title={t("删除 {0}？", {"0": bot.name})}
          message={t("该智能体的会话也将移除，其他智能体及其会话不受影响。")}
          confirmLabel={t("删除此智能体")}
          onCancel={() => setConfirming(false)}
          busy={deleting} error={deleteError}
          onConfirm={() => {
            if (deleting) return;
            setDeleting(true); setDeleteError('');
            void removeBot(bot.id).then(() => { onClose(); onDeleted(); })
              .catch(error => setDeleteError(error instanceof Error ? error.message : t('无法删除智能体。')))
              .finally(() => setDeleting(false));
          }}
        />
      ) : (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.face}>
          <Bloub shape={shape} color={color} size={72} />
        </View>

        <Field label={t("名称")} value={name} onChange={setName} placeholder={t("智能体名称")} editable={!busy} />

        <SectionLabel>{t("形状")}</SectionLabel>
        <View style={styles.shapeGrid}>
          {SHAPES.map((option) => (
            <Pressable
              key={option.id}
              disabled={busy}
              style={[styles.shapeOption, shape === option.id && styles.shapeOn]}
              onPress={() => setShape(option.id)}
              accessibilityLabel={t(option.label)}
            >
              <Bloub shape={option.id} color="#9a9aa2" size={22} />
            </Pressable>
          ))}
        </View>

        <SectionLabel>{t("颜色")}</SectionLabel>
        <View style={styles.colorGrid}>
          {COLORS.map((dot) => (
            <Pressable
              key={dot}
              disabled={busy}
              onPress={() => setColor(dot)}
              style={[styles.dot, { backgroundColor: dot }, color === dot && styles.dotOn]}
              accessibilityLabel={t("颜色 {0}", {"0": dot})}
            />
          ))}
        </View>

        <View style={styles.buttons}>
          {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
          <PrimaryButton label={saving ? t('正在保存…') : t("保存更改")} disabled={busy} onPress={() => void save()} />
          <View style={styles.gap} />
          <PrimaryButton
            label={t("打开会话")}
            tone="quiet"
            disabled={busy}
            onPress={() => {
              onClose();
              if (thread) onOpen(thread.id);
            }}
          />
          <View style={styles.gap} />
          <PrimaryButton label={bot.primary ? t("主智能体不能删除。") : t("删除此智能体")} disabled={busy || Boolean(bot.primary)} tone="danger" onPress={() => setConfirming(true)} />
        </View>
        <Text style={styles.note}>
          {t("记忆保存在服务器上，此处仅修改智能体的名称和外观。")}
        </Text>
      </ScrollView>
      )}
    </Sheet>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  scroll: { flexShrink: 1 },
  body: { paddingTop: 6, paddingHorizontal: 12, paddingBottom: 18 },
  face: { alignItems: 'center', paddingVertical: 10 },
  shapeGrid: { flexDirection: 'row', gap: 4 },
  shapeOption: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: C.card,
  },
  shapeOn: { backgroundColor: C.field2, borderWidth: 1, borderColor: C.strongBorder },
  colorGrid: { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: C.border },
  dotOn: { borderWidth: 2, borderColor: C.paper },
  buttons: { marginTop: 16 },
  error: { color: C.red, fontSize: 11, lineHeight: 16, marginBottom: 8 },
  gap: { height: 8 },
  note: { marginTop: 12, color: INK.quiet, fontSize: 10, lineHeight: 14 },
}));
