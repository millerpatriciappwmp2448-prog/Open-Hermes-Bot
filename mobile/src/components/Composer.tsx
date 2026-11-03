import { t, useTranslation } from "../i18n";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, Text, TextInput, View, type TextInputInstance } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { Attachment, Bot, MessageKind, Thread } from '../data';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { ArrowUpIcon, CameraIcon, CloseIcon, FileIcon, MicIcon, PhotoIcon, PlusIcon, StopIcon } from './Icons';
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
  bottomInset: number;
};

/**
 * What a person types into, attaches through, and dictates into. Everything
 * it offers answers: a file becomes a message, the microphone becomes a
 * voice note, and an @ opens the roster of the round.
 */
export function Composer({ thread, bots, onSend, bottomInset }: ComposerProps) {
  const { styles, C, INK, scheme } = useStyles();
  useTranslation();
  const { prefs, stop } = useStore();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [attaching, setAttaching] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const pickerLock = useRef(false);
  const pendingPicker = useRef<'photo' | 'file' | 'camera' | null>(null);
  const mounted = useRef(true);
  const typing = useRef(thread.typing);
  typing.current = thread.typing;
  const input = useRef<TextInputInstance>(null);
  const dockStyle = [styles.dock, { paddingBottom: Math.max(12, bottomInset) }];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pendingPicker.current = null; };
  }, []);

  function sendAttachment(attachment: Attachment) {
    if (!mounted.current || typing.current) return;
    input.current?.blur();
    Keyboard.dismiss();
    onSend({ text: attachment.name, kind: 'attachment', attachment });
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'image.jpg';
      const size = asset.fileSize ? `${(asset.fileSize / 1024 / 1024).toFixed(1)} MB` : '未知';
      sendAttachment({ kind: '照片', name, size, uri: asset.uri,
        bytes: asset.fileSize, mimeType: asset.mimeType, file: asset.file });
    }
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const size = asset.size ? `${(asset.size / 1024).toFixed(1)} KB` : '未知';
      sendAttachment({ kind: '文件', name: asset.name, size, uri: asset.uri,
        bytes: asset.size, mimeType: asset.mimeType, file: asset.file });
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('无法使用相机'), t('请在系统设置中允许访问相机。'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const name = asset.fileName ?? `照片-${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}.jpg`;
      const size = asset.fileSize ? `${(asset.fileSize / 1024 / 1024).toFixed(1)} MB` : '未知';
      sendAttachment({ kind: '相机', name, size, uri: asset.uri,
        bytes: asset.fileSize, mimeType: asset.mimeType, file: asset.file });
    }
  }

  function queuePicker(kind: 'photo' | 'file' | 'camera') {
    if (pickerLock.current || typing.current) return;
    pickerLock.current = true;
    setPickerBusy(true);
    pendingPicker.current = kind;
    setAttaching(false);
  }

  async function openPendingPicker() {
    const kind = pendingPicker.current;
    pendingPicker.current = null;
    if (!kind) return;
    try {
      if (!mounted.current || typing.current) return;
      if (kind === 'photo') await pickPhoto();
      else if (kind === 'file') await pickFile();
      else await takePhoto();
    } catch {
      if (mounted.current) Alert.alert(t('无法添加附件'), t('请选择其他文件或重试。'));
    } finally {
      pickerLock.current = false;
      if (mounted.current) setPickerBusy(false);
    }
  }

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
    input.current?.blur();
    Keyboard.dismiss();
  }

  if (recording) {
    return (
      <View style={dockStyle}>
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
    <View style={dockStyle}>
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

        <View style={styles.composerRow} testID="chat-composer">
          <Pressable
            style={[styles.attach, (thread.typing || pickerBusy) && { opacity: 0.4 }]}
            disabled={thread.typing || pickerBusy}
            onPress={() => setAttaching(true)}
            accessibilityRole="button"
            accessibilityLabel={t("添加附件")}
          >
            <PlusIcon size={20} />
          </Pressable>
          <View style={styles.composer}>
            <TextInput keyboardAppearance={scheme}
              ref={input}
              value={draft}
              onChangeText={setDraft}
              placeholder={t("给 Hermes 发消息")}
              placeholderTextColor={INK.meta}
              accessibilityLabel={t("给 Hermes 发消息")}
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
                <StopIcon size={13} color={C.bg} />
              </Pressable>
            ) : draft.trim() ? (
              <Pressable
                style={[styles.button, styles.cream]}
                onPress={send}
                accessibilityRole="button"
                accessibilityLabel={t("发送")}
              >
                <ArrowUpIcon size={17} color={C.bg} />
              </Pressable>
            ) : (
              <Pressable
                style={[styles.button, styles.microphone]}
                onPress={() => {
                  setSeconds(0);
                  setRecording(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={t("语音输入")}
              >
                <MicIcon size={16} color={INK.quiet} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <Sheet visible={attaching} onClose={() => setAttaching(false)} onDismiss={openPendingPicker}>
        <SheetHeader
          title={t("添加附件")}
          onClose={() => setAttaching(false)}
        />
        <View style={styles.attachBody}>
          <Row
            name={t("照片")}
            meta={t("从相册选择")}
            chevron={false}
            onPress={() => queuePicker('photo')}
            right={<PhotoIcon />}
          />
          <View style={styles.attachLine}>
            <Row
              name={t("文件")}
              meta={t("从文件中选择")}
              chevron={false}
              onPress={() => queuePicker('file')}
              right={<FileIcon />}
            />
          </View>
          <View style={styles.attachLine}>
            <Row
              name={t("相机")}
              meta={t("拍摄照片")}
              chevron={false}
              onPress={() => queuePicker('camera')}
              right={<CameraIcon />}
            />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  dock: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 12 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  composer: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 46,
    padding: 5,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: 25,
    backgroundColor: C.cardRaised,
    boxShadow: '0px 3px 16px rgba(0,0,0,0.05)',
  },
  button: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 },
  attach: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23,
    backgroundColor: C.cardRaised, borderWidth: 1, borderColor: C.hairline,
    boxShadow: '0px 3px 16px rgba(0,0,0,0.05)',
  },
  cream: { backgroundColor: C.text },
  microphone: { backgroundColor: C.hover },
  input: { flex: 1, minWidth: 0, paddingHorizontal: 9, paddingVertical: 7, color: C.text, fontSize: 14 },

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
}), false);
