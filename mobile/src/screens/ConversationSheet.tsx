import { t, useTranslation } from "../i18n";
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Sheet } from '../components/Sheet';
import { Bloub } from '../components/Bloub';
import { ModelList } from '../components/ModelList';
import { Toggle } from '../components/Toggle';
import { ConfirmBlock, PrimaryButton, Row, SectionLabel, SheetHeader } from '../components/UI';
import { useStore } from '../store';
import { C, createStyles } from '../theme';

/**
 * What a conversation is, and what can be done to it. The model is per
 * conversation; the memory is the bot's, on the host, and is not touched by
 * anything here.
 */
export function ConversationSheet({
  visible,
  onClose,
  threadId,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  onDeleted: () => void;
}) {
  useTranslation();
  const { threadById, botById, toggles, toggle, setModel, clearThread, removeThread, togglePin } =
    useStore();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState<'clear' | 'delete' | null>(null);
  const thread = threadById(threadId);
  const bot = thread ? botById(thread.botId) : undefined;

  if (!thread) return null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      {picking ? (
        <>
          <SheetHeader
            title={t("模型")}
            sub={t("仅用于当前会话，机器人的记忆保持不变。")}
            onClose={onClose}
            back={() => setPicking(false)}
          />
          <ModelList
            selected={thread.threadModel}
            onPick={(picked) => {
              setModel(thread.id, picked);
              setPicking(false);
            }}
          />
        </>
      ) : (
        <>
          <SheetHeader
            title={thread.name}
            sub={t("Hermes 主机 · {0}", {"0": thread.threadModel})}
            onClose={onClose}
          />
          {confirming ? (
            <ConfirmBlock
              title={
                confirming === 'clear' ? t("清空此会话？") : t("删除此会话？")
              }
              message={
                confirming === 'clear'
                  ? t("将清空当前显示的消息，机器人的记忆和服务器会话仍会保留。")
                  : t("将删除该会话，机器人及其记忆仍会保留。")
              }
              confirmLabel={confirming === 'clear' ? t("清空") : t("删除")}
              onCancel={() => setConfirming(null)}
              onConfirm={() => {
                if (confirming === 'clear') {
                  clearThread(thread.id);
                  setConfirming(null);
                  onClose();
                } else {
                  removeThread(thread.id);
                  setConfirming(null);
                  onClose();
                  onDeleted();
                }
              }}
            />
          ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.face}>
              <Bloub shape={bot?.shape} color={bot?.color ?? '#8b5cf6'} size={54} />
            </View>

            <SectionLabel>{t("会话")}</SectionLabel>
            <View style={styles.card}>
              <Row name={t("模型")} value={thread.threadModel} onPress={() => setPicking(true)} />
              <View style={styles.line} />
              <Row name={t("会话数")} value={t("1 个会话")} chevron={false} />
              <View style={styles.line} />
              <Row
                name={t("已置顶")}
                chevron={false}
                right={
                  <Toggle
                    on={Boolean(thread.pinned)}
                    onChange={() => togglePin(thread.id)}
                    label={t("已置顶")}
                  />
                }
              />
              <View style={styles.line} />
              <Row
                name={t("表情回应")}
                chevron={false}
                right={
                  <Toggle
                    on={toggles.tapbacks}
                    onChange={() => toggle('tapbacks')}
                    label={t("表情回应")}
                  />
                }
              />
              <View style={styles.line} />
              <Row
                name={t("通知")}
                chevron={false}
                right={
                  <Toggle
                    on={toggles.notifications}
                    onChange={() => toggle('notifications')}
                    label={t("通知")}
                  />
                }
              />
            </View>

            <View style={styles.buttons}>
              <PrimaryButton
                label={t("清空会话")}
                tone="quiet"
                onPress={() => setConfirming('clear')}
              />
              <View style={styles.gap} />
              <PrimaryButton
                label={t("删除会话")}
                tone="danger"
                onPress={() => setConfirming('delete')}
              />
            </View>
          </ScrollView>
          )}
        </>
      )}
    </Sheet>
  );
}

const styles = createStyles({
  body: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 18, flexShrink: 1 },
  face: { alignItems: 'center', paddingVertical: 10 },
  card: { borderRadius: 13, backgroundColor: C.cardRaised, overflow: 'hidden' },
  line: { height: 1, backgroundColor: C.hairline },
  buttons: { marginTop: 14 },
  gap: { height: 8 },
});
