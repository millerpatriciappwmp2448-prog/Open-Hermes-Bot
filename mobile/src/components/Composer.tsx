import { t, useTranslation } from "../i18n";
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Attachment, Bot, MessageKind, Thread } from '../data';
import { ATTACHMENTS } from '../data';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { ArrowUpIcon, AttachIcon, CameraIcon, CloseIcon, FileIcon, MicIcon, PhotoIcon, StopIcon } from './Icons';
import { Sheet } from './Sheet';
import { Bloub } from './Bloub';
import { Row, SheetHeader } from './UI';

/** The bars of the waveform, in the heights the mockup draws them. */
const WAVE = [7, 14, 20, 11, 24, 16, 9, 19, 25, 13, 8, 18, 23, 12, 21, 15, 9, 17];

function clock(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export type Outgoing = {
  text: string;
  kind?: MessageKind;
  attachment?: Attachment;
  duration?: string;
};

type ComposerProps = {
  thread: Thread;
  bots: Bot[];
  onSend: (payload: Outgoing) => void;
};

/**
 * What a person types into, attaches through, and dictates into. Everything
 * it offers answers: a file becomes a message, the microphone becomes a
 * voice note, and an @ opens the roster of the round.
 */
export function Composer({ thread, bots, onSend }: ComposerProps) {
  const { styles, C, INK, scheme } = useStyles();
  useTranslation();
  const { prefs, stop } = useStore();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const members = useMemo(
    () =>
      (thread.members ?? [])
        .map((id) => bots.find((bot) => bot.id === id))
        .filter(Boolean) as Bot[],
    [bots, thread.members],
  );

  // The roster opens on an @ that names nobody yet.
  const query = /(?:^|\s)@(\w*)$/.exec(draft)?.[1];
  const roster =
    query === undefined
      ? []
      : members.filter((bot) => bot.name.toLowerCase().startsWith(query.toLowerCase()));

  function insert(bot: Bot) {
    setDraft((current) => current.replace(/@(\w*)$/, `@${bot.name} `));
  }

  function send() {
    // A reply is still being written: keep the draft for the next turn.
    if (!draft.trim() || thread.typing) return;
    onSend({ text: draft });
    setDraft('');
  }

  if (recording) {
    return (
      <View style={styles.dock}>
        <View style={styles.recordingMeta}>
          <View style={styles.liveDot} />
          <Text style={styles.recordingLabel}>{t("正在聆听")}</Text>
        </View>
        <View style={styles.recorder}>
          <Pressable
            style={[styles.round, styles.cancel]}
            onPress={() => setRecording(false)}
            accessibilityLabel={t("取消语音输入")}
          >
            <CloseIcon size={15} color={C.recordingInk} />
          </Pressable>
          <View style={styles.waveform}>
            {WAVE.map((height, index) => (
              <View key={index} style={[styles.bar, { height }]} />
            ))}
          </View>
          <Text style={styles.time}>{clock(seconds)}</Text>
          <Pressable
            style={[styles.round, styles.sendButton]}
            accessibilityLabel={t("发送语音")}
            onPress={() => {
              const duration = clock(seconds);
              setRecording(false);
              onSend({ text: t("语音消息 · {0}", {"0": duration}), kind: 'voice', duration });
            }}
          >
            <ArrowUpIcon size={17} />
          </Pressable>
        </View>
        <Text style={styles.note}>
          {prefs.voice === 'host'
            ? t("由 Hermes 主机转写 · 当前为演示功能")
            : t("在本机转写 · 当前为演示功能")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.dock}>
      <View>
        {roster.length > 0 ? (
          <View style={styles.roster}>
            {roster.map((bot, index) => (
              <Pressable
                key={bot.id}
                style={[styles.option, index === 0 && styles.optionActive]}
                onPress={() => insert(bot)}
              >
                <Bloub shape={bot.shape} color={bot.color} size={18} />
                <Text style={styles.optionName}>{bot.name}</Text>
                <Text style={styles.optionRole}>{bot.role}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.composer}>
          <Pressable
            style={[styles.button, styles.attach]}
            onPress={() => setAttaching(true)}
            accessibilityLabel={t("添加附件")}
          >
            <AttachIcon />
          </Pressable>
          <TextInput keyboardAppearance={scheme}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("给 Hermes 发消息")}
            placeholderTextColor={INK.meta}
            style={styles.input}
            returnKeyType="send"
            onSubmitEditing={send}
            blurOnSubmit={false}
          />
          {thread.typing ? (
            <Pressable
              style={[styles.button, styles.cream]}
              onPress={() => stop(thread.id)}
              accessibilityRole="button"
              accessibilityLabel={t("停止")}
            >
              <StopIcon />
            </Pressable>
          ) : draft.trim() ? (
            <Pressable
              style={[styles.button, styles.cream]}
              onPress={send}
              accessibilityLabel={t("发送")}
            >
              <ArrowUpIcon />
            </Pressable>
          ) : (
            <Pressable
              style={[styles.button, styles.cream]}
              onPress={() => {
                setSeconds(0);
                setRecording(true);
              }}
              accessibilityLabel={t("语音输入")}
            >
              <MicIcon />
            </Pressable>
          )}
        </View>
      </View>

      <Sheet visible={attaching} onClose={() => setAttaching(false)}>
        <SheetHeader
          title={t("添加附件")}
          sub={t("这里展示的是演示文件，不会读取手机上的真实文件。")}
          onClose={() => setAttaching(false)}
        />
        <View style={styles.attachBody}>
          {ATTACHMENTS.map((item, index) => (
            <View key={item.kind} style={index > 0 ? styles.attachLine : undefined}>
              <Row
                name={t(item.kind)}
                meta={`${t(item.name)} · ${item.size}`}
                chevron={false}
                onPress={() => {
                  setAttaching(false);
                  onSend({ text: item.name, kind: 'attachment', attachment: item });
                }}
                right={
                  item.kind === "照片" ? (
                    <PhotoIcon />
                  ) : item.kind === "文件" ? (
                    <FileIcon />
                  ) : (
                    <CameraIcon />
                  )
                }
              />
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  dock: { paddingTop: 6, paddingHorizontal: 9, paddingBottom: 10 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 50,
    padding: 5,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 25,
    backgroundColor: C.field,
  },
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  attach: { backgroundColor: C.field2 },
  cream: { backgroundColor: C.paper },
  input: { flex: 1, paddingHorizontal: 3, color: C.text, fontSize: 13 },

  roster: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    marginBottom: 7,
    zIndex: 40,
    padding: 4,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 13,
    backgroundColor: C.field,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 7,
    borderRadius: 8,
  },
  optionActive: { backgroundColor: C.field2 },
  optionName: { color: C.text, fontSize: 12 },
  optionRole: {
    marginLeft: 'auto',
    color: INK.quiet,
    fontSize: 8,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  attachBody: { marginTop: 12, paddingHorizontal: 12 },
  attachLine: { borderTopWidth: 1, borderTopColor: C.hairline },

  recordingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 7,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.red },
  recordingLabel: { color: INK.meta, fontSize: 10 },
  recorder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 54,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,95,87,0.16)',
    borderRadius: 27,
    backgroundColor: C.recording,
  },
  round: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  cancel: { backgroundColor: C.recordingButton },
  sendButton: { backgroundColor: C.paper },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2.5,
    height: 26,
    overflow: 'hidden',
  },
  bar: { width: 2.5, borderRadius: 2, backgroundColor: C.recordingInk },
  time: { color: C.recordingInk, fontSize: 9, fontVariant: ['tabular-nums'] },
  note: { marginTop: 7, color: INK.label, fontSize: 9, textAlign: 'center' },
}));
