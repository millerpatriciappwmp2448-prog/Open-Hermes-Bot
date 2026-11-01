import { t, useTranslation } from "../i18n";
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Sheet } from '../components/Sheet';
import { Bloub, BloubGroup } from '../components/Bloub';
import { ChevronIcon, CloseIcon } from '../components/Icons';
import { ConfirmBlock } from '../components/UI';
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
}: {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  onLeave: () => void;
  onModel: () => void;
}) {
  const { styles } = useStyles();
  useTranslation();
  const { threadById, botById, updateGroup, leaveGroup } = useStore();
  const afterClose = useRef<'model' | 'leave' | null>(null);
  const [pending, setPending] = useState<
    { kind: 'leave' } | { kind: 'remove'; id: string; name: string } | null
  >(null);
  const thread = threadById(threadId);
  // Read once: the callbacks below run later, when the narrowing is gone.
  const memberIds = thread?.members ?? [];

  const members = memberIds.map((id) => botById(id)).filter(Boolean);
  const faces = members.map((bot) => ({ shape: bot!.shape, color: bot!.color }));

  return (
    <Sheet visible={visible} onClose={onClose} onDismiss={() => {
      const action = afterClose.current;
      afterClose.current = null;
      setPending(null);
      if (action === 'model') onModel();
      if (action === 'leave') { leaveGroup(threadId); onLeave(); }
    }}>
        <>
          <View style={styles.top}>
            <Pressable style={styles.close} onPress={onClose} accessibilityLabel={t("关闭")}>
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
              onCancel={() => setPending(null)}
              onConfirm={() => {
                if (pending.kind === 'leave') {
                  afterClose.current = 'leave';
                  onClose();
                } else {
                  updateGroup(threadId, {
                    members: memberIds.filter((id) => id !== pending.id),
                  });
                  setPending(null);
                }
              }}
            />
          ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.label}>{t("成员")}</Text>
            <View style={styles.card}>
              {members.map((bot, index) => (
                <Pressable
                  key={bot!.id}
                  style={[styles.row, index > 0 && styles.line]}
                  onPress={() =>
                    setPending({ kind: 'remove', id: bot!.id, name: bot!.name })
                  }
                >
                  <Bloub shape={bot!.shape} color={bot!.color} size={26} />
                  <View style={styles.copy}>
                    <Text style={styles.rowName}>{bot!.name}</Text>
                    <Text style={styles.rowMeta}>
                      {bot!.role} {t("· 会话")} {bot!.session}
                    </Text>
                  </View>
                  <ChevronIcon />
                </Pressable>
              ))}
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
                <Text style={styles.value}>{thread?.threadModel}</Text>
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
