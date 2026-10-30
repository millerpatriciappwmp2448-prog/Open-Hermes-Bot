import { t, useTranslation } from "../i18n";
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Sheet } from '../components/Sheet';
import { Hint, Row, SheetHeader } from '../components/UI';
import { CopyIcon, TrashIcon } from '../components/Icons';
import type { Message } from '../data';
import { useStore } from '../store';
import { themedStyles } from '../theme';

const EMOJI = ['👍', '❤️', '🎯', '👀'];

/**
 * What a hand can do to a bubble: a tapback, a copy, or nothing at all. The
 * tapback is the same four the round uses; pressing it again takes it back.
 */
export function MessageSheet({
  visible,
  onClose,
  threadId,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  message: Message | null;
}) {
  const { styles } = useStyles();
  useTranslation();
  const { react, removeMessage } = useStore();
  const [copied, setCopied] = useState(false);

  if (!message) return null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetHeader
        title={t("消息")}
        sub={message.from === 'user' ? t("你发送的消息") : t("机器人的消息")}
        onClose={onClose}
      />

      <View style={styles.emojiRow}>
        {EMOJI.map((emoji) => (
          <Pressable
            key={emoji}
            style={[styles.emojiButton, message.reaction?.emoji === emoji && styles.emojiOn]}
            onPress={() => {
              react(threadId, message.id, emoji);
              onClose();
            }}
            accessibilityLabel={t("回应 {0}", {"0": emoji})}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actions}>
        <Row
          name={copied ? t("已复制") : t("复制文本")}
          chevron={false}
          onPress={async () => {
            await Clipboard.setStringAsync(message.text);
            setCopied(true);
          }}
          right={<CopyIcon />}
        />
        <View style={styles.line} />
        <Row
          name={t("删除")}
          chevron={false}
          onPress={() => {
            removeMessage(threadId, message.id);
            onClose();
          }}
          right={<TrashIcon />}
        />
      </View>

      <View style={styles.hint}>
        <Hint>{t("表情回应和本页删除操作仅在当前应用运行期间有效，不会写入服务器。")}</Hint>
      </View>
    </Sheet>
  );
}

const useStyles = themedStyles(({ C }) => ({
  emojiRow: { flexDirection: 'row', gap: 8, paddingTop: 14, paddingHorizontal: 16 },
  emojiButton: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: C.card,
  },
  emojiOn: { borderWidth: 1, borderColor: C.paper },
  emoji: { fontSize: 20 },
  actions: { marginTop: 14, marginHorizontal: 12, borderRadius: 13, backgroundColor: C.cardRaised, overflow: 'hidden' },
  line: { height: 1, backgroundColor: C.hairline },
  hint: { paddingHorizontal: 16 },
}));
