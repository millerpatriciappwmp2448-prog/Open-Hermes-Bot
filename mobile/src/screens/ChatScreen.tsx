import { t, useTranslation } from "../i18n";
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bloub, BloubGroup } from '../components/Bloub';
import { BackIcon, FileIcon, MicIcon, MoreIcon, PhotoIcon } from '../components/Icons';
import { Composer, type Outgoing } from '../components/Composer';
import { TaskDock } from '../components/TaskDock';
import { TypingDots } from '../components/TypingDots';
import { BotSheet } from './BotSheet';
import { GroupDetailsSheet } from './GroupDetailsSheet';
import { MessageSheet } from './MessageSheet';
import { CHAT_EVENTS, type Bot, type Message } from '../data';
import { useStore } from '../store';
import type { RootStackParamList } from '../nav';
import { themedStyles } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The @ that names a bot of the round, in the bubble's own colour. */
function MessageText({ text, users, style }: { text: string; users: Bot[]; style: object }) {
  const { styles } = useStyles();
  const names = users.map((bot) => bot.name).sort((a, b) => b.length - a.length);
  if (names.length === 0 || !text.includes('@')) {
    return <Text style={style}>{text}</Text>;
  }
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g');
  const parts = text.split(pattern);
  return (
    <Text style={style}>
      {parts.map((part, index) =>
        part.startsWith('@') && names.includes(part.slice(1)) ? (
          <Text key={index} style={styles.mention}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

export function ChatScreen({ route, navigation }: Props) {
  const { styles, C } = useStyles();
  useTranslation();
  const insets = useSafeAreaInsets();
  const {
    messages,
    bots,
    botById,
    chatPreferences,
    send,
    markRead,
    threadById,
    loadTodos,
    connection,
  } = useStore();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [active, setActive] = useState<Message | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const thread = threadById(route.params.threadId);
  const threadId = route.params.threadId;

  // Opening a conversation reads it: the dot is the app's, not the bot's.
  useEffect(() => {
    markRead(threadId);
  }, [markRead, threadId]);

  // The agent's own task list for this session, read from Hermes.
  const sessionId = thread?.sessionId;
  useEffect(() => {
    void loadTodos(threadId);
  }, [loadTodos, threadId, sessionId, connection.status]);

  if (!thread) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.nav} testID="chat-header">
          <Pressable style={styles.navIcon} onPress={() => navigation.goBack()} accessibilityLabel={t("返回")}>
            <BackIcon size={17} color={C.text} />
          </Pressable>
          <View style={styles.navCenter}>
            <View style={styles.chatId}>
              <Text style={styles.chatName} numberOfLines={1}>{t("此会话已不存在")}</Text>
            </View>
          </View>
          <View style={styles.navPlaceholder} />
        </View>
        <Text style={styles.missing}>{t("此会话已删除，可返回会话列表查看其他会话。")}</Text>
      </View>
    );
  }

  const bot = botById(thread.botId);
  const tapbacks = chatPreferences[thread.botId]?.tapbacks !== false;
  const members = (thread.members ?? [])
    .map((id) => botById(id))
    .filter(Boolean) as Bot[];
  const faces =
    thread.kind === 'group' ? members.map((entry) => ({ shape: entry.shape, color: entry.color })) : [];
  const turns = messages[thread.id] ?? [];
  const meta = CHAT_EVENTS[thread.id];
  const isGroup = thread.kind === 'group';
  // In a group, each agent's newest message keeps a live face; older ones stay
  // still so a long history does not redraw dozens of faces every frame.
  const liveFaces = new Set<string>();
  if (isGroup) {
    const seen = new Set<string>();
    for (let index = turns.length - 1; index >= 0; index--) {
      const turn = turns[index];
      if (turn.from === 'user' || seen.has(turn.from)) continue;
      seen.add(turn.from);
      liveFaces.add(turn.id);
    }
  }

  function delivery(payload: Outgoing) {
    send(threadId, payload);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 40);
  }

  function renderMessage(message: Message) {
    const mine = message.from === 'user';
    const author = mine ? null : botById(message.from);
    const failed = !mine && message.failed;
    const ink = mine ? styles.bubbleUserText : failed ? styles.bubbleFailedText : styles.bubbleBotText;

    return (
      <View
        key={message.id}
        style={[styles.msg, mine ? styles.msgUser : isGroup ? styles.msgGroup : styles.msgBot]}
      >
        {isGroup && !mine && author ? (
          <View style={styles.msgAvatar}>
            <Bloub shape={author.shape} color={author.color} size={24} animated={liveFaces.has(message.id)} />
          </View>
        ) : null}

        <View style={[styles.bubbleWrap, mine && styles.bubbleWrapUser]}>
          {isGroup && !mine && author ? <Text style={styles.author}>{author.name}</Text> : null}

          <Pressable
            onLongPress={() => setActive(message)}
            delayLongPress={260}
            style={[
              styles.bubble,
              mine ? styles.bubbleUser : styles.bubbleBot,
              isGroup && styles.bubbleGroup,
              failed && styles.bubbleFailed,
            ]}
            accessibilityHint={tapbacks ? t("长按可添加表情回应、复制或删除") : t('长按可复制或删除')}
          >
            {failed ? <Text style={styles.failedLabel}>{t("回复失败")}</Text> : null}
            {message.kind === 'attachment' && message.attachment ? (
              <View style={styles.attachment}>
                {message.attachment.name.endsWith('.HEIC') || message.attachment.name.endsWith('.jpg') ? (
                  <PhotoIcon color={mine ? C.bg : C.text} />
                ) : (
                  <FileIcon color={mine ? C.bg : C.text} />
                )}
                <View style={styles.attachmentCopy}>
                  <Text style={ink} numberOfLines={1}>
                    {message.attachment.name}
                  </Text>
                  <Text style={[styles.attachmentSize, mine ? styles.onPaperQuiet : null]}>
                    {message.attachment.size}
                  </Text>
                </View>
              </View>
            ) : message.kind === 'voice' ? (
              <View style={styles.voice}>
                <MicIcon size={14} color={mine ? C.bg : C.text} />
                <Text style={ink}>{t("语音消息")}</Text>
                <Text style={[styles.voiceTime, mine ? styles.onPaperQuiet : null]}>
                  {message.duration ?? '0:07'}
                </Text>
              </View>
            ) : (
              <MessageText text={message.text} users={members} style={ink} />
            )}
          </Pressable>

          {message.reaction && tapbacks ? (
            <Pressable
              style={styles.tapback}
              onPress={() => setActive(message)}
              accessibilityLabel={t("更改表情回应")}
            >
              <Text style={styles.tapbackEmoji}>{message.reaction.emoji}</Text>
              <Text style={styles.tapbackCount}>{message.reaction.count}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.nav} testID="chat-header">
          <Pressable style={styles.navIcon} onPress={() => navigation.goBack()} accessibilityLabel={t("返回")}>
            <BackIcon size={17} color={C.text} />
          </Pressable>

          <View style={styles.navCenter}>
            <Pressable
              style={styles.chatId}
              onPress={() => (isGroup ? setDetailsOpen(true) : setBotOpen(true))}
              accessibilityRole="button"
              accessibilityLabel={t("打开 {0}", {"0": thread.name})}
              testID="chat-identity"
            >
              {isGroup ? (
                <BloubGroup members={faces} size={23} active={thread.typing} />
              ) : (
                <Bloub shape={bot?.shape} color={bot?.color ?? '#8b5cf6'} size={23} active={thread.typing} />
              )}
              <View style={styles.chatTitles}>
                <Text style={styles.chatName} numberOfLines={1}>
                  {thread.name}
                </Text>
              </View>
            </Pressable>
          </View>

          <Pressable
            style={styles.navIcon}
            onPress={() => (isGroup ? setDetailsOpen(true) : navigation.navigate('ChatSettings', { threadId: thread.id }))}
            accessibilityLabel={isGroup ? t("群组详情") : t("会话详情")}
          >
            <MoreIcon size={18} color={C.text} />
          </Pressable>
        </View>

        <ScrollView
          ref={scroll}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {meta ? (
            <>
              <Text style={styles.event}>{t(meta.event)}</Text>
              <Text style={styles.time}>{t(meta.time)}</Text>
            </>
          ) : null}

          {turns.length === 0 ? (
            <Text style={styles.empty}>
              {t("还没有消息，发送第一条消息开始聊天。智能体的记忆保存在服务器上。")}
            </Text>
          ) : null}

          {turns.map(renderMessage)}

          {meta?.typing || thread.typing ? (
            <View style={styles.typing}>
              <Bloub shape={bot?.shape ?? 'capsule'} color={bot?.color ?? '#4f9d8f'} size={18} animated active />
              <Text style={styles.typingLabel} numberOfLines={1}>
                {thread.tool
                  ? t("正在使用工具：{0}", {"0": thread.tool})
                  : `${thread.name} ${t("正在思考")}`}
              </Text>
              <TypingDots />
            </View>
          ) : null}
        </ScrollView>

        {!isGroup ? <TaskDock todos={thread.todos} running={!!thread.typing} /> : null}
        <Composer thread={thread} bots={bots} onSend={delivery} bottomInset={keyboardVisible ? 0 : insets.bottom} />
      </View>

      {/* The bot itself, from its face at the top of the conversation. */}
      <BotSheet
        visible={botOpen}
        botId={isGroup ? null : (bot?.id ?? null)}
        onClose={() => setBotOpen(false)}
        onOpen={() => setBotOpen(false)}
        onDeleted={() => {
          setBotOpen(false);
          navigation.goBack();
        }}
      />

      <GroupDetailsSheet
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        threadId={thread.id}
        onLeave={() => navigation.goBack()}
        onModel={() => navigation.navigate('ChatModel', { threadId: thread.id })}
      />
      <MessageSheet
        visible={active !== null}
        onClose={() => setActive(null)}
        threadId={thread.id}
        message={active}
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  root: { flex: 1, backgroundColor: C.bg },
  missing: { color: INK.quiet, padding: 20, fontSize: 12 },

  nav: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.bg,
  },
  navIcon: {
    width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 20,
    backgroundColor: C.cardRaised, borderWidth: 1, borderColor: C.hairline,
    boxShadow: '0px 3px 12px rgba(0,0,0,0.04)',
  },
  chatId: {
    flexShrink: 1, minWidth: 0, maxWidth: '100%', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 22,
    backgroundColor: C.cardRaised, borderWidth: 1, borderColor: C.hairline,
    boxShadow: '0px 3px 12px rgba(0,0,0,0.04)',
  },
  chatTitles: { flexShrink: 1, minWidth: 0 },
  chatName: { color: C.text, fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  navCenter: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  navPlaceholder: { width: 40, flexShrink: 0 },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  event: { marginBottom: 6, color: INK.faint, fontSize: 11, textAlign: 'center' },
  time: { marginBottom: 20, color: INK.meta, fontSize: 11, textAlign: 'center' },
  empty: { color: INK.quiet, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 20, marginTop: 24 },

  msg: { width: '100%', marginBottom: 12 },
  msgUser: { alignItems: 'flex-end' },
  msgBot: { alignItems: 'flex-start' },
  msgGroup: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  msgAvatar: { marginTop: 20 },
  bubbleWrap: { flexShrink: 1, maxWidth: '92%', alignItems: 'flex-start' },
  bubbleWrapUser: { alignItems: 'flex-end', maxWidth: '82%' },

  bubble: { maxWidth: '100%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 19 },
  bubbleBot: {
    backgroundColor: C.cardRaised, borderWidth: 1, borderColor: C.line,
    boxShadow: '0px 2px 5px rgba(0,0,0,0.025)',
  },
  bubbleUser: { backgroundColor: C.text },
  bubbleGroup: { maxWidth: '100%' },
  bubbleBotText: { color: C.text, fontSize: 14, lineHeight: 21 },
  bubbleUserText: { color: C.bg, fontSize: 14, lineHeight: 21 },
  bubbleFailed: { borderWidth: 1, borderColor: C.border, backgroundColor: C.recording },
  bubbleFailedText: { color: C.recordingInk, fontSize: 14, lineHeight: 21 },
  failedLabel: { marginBottom: 2, color: C.recordingInk, fontSize: 11, fontWeight: '600' },
  mention: { backgroundColor: C.mention, borderRadius: 4, fontWeight: '500' },

  attachment: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 150 },
  attachmentCopy: { flexShrink: 1 },
  attachmentSize: { color: INK.quiet, fontSize: 9, marginTop: 1 },
  onPaperQuiet: { color: C.bg, opacity: 0.8 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 130 },
  voiceTime: { color: INK.quiet, fontSize: 10, fontVariant: ['tabular-nums'] },

  author: { marginLeft: 3, marginBottom: 5, color: INK.quiet, fontSize: 11, fontWeight: '500' },
  tapback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 21,
    marginTop: 4,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 11,
    backgroundColor: C.bean,
  },
  tapbackEmoji: { fontSize: 10 },
  tapbackCount: { color: INK.quiet, fontSize: 9 },

  typing: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  typingLabel: { flexShrink: 1, color: INK.quiet, fontSize: 11 },
}), false);
