import { localeTag, t, useTranslation } from "../i18n";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Keyboard, Linking, Platform, Pressable, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { Attachment, Bot, MessageKind, Thread } from '../data';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { createDictation, type DictationError, type DictationState } from '../dictation';
import { getDictationRecognizer } from '../dictationDevice';
import { ArrowUpIcon, CameraIcon, CheckIcon, CloseIcon, FileIcon, MicIcon, PhotoIcon, PlusIcon, StopIcon } from './Icons';
import { Sheet } from './Sheet';
import { Bloub } from './Bloub';
import { Row, SheetHeader } from './UI';

/** The draft grows with its lines up to about five, then scrolls inside. */
const INPUT_MIN = 36;
const INPUT_MAX = 120;

/** Five level bars that follow the microphone volume while listening. */
const LEVELS = [8, 14, 20, 14, 8];
const IDLE_DICTATION: DictationState = { phase: 'idle', transcript: '', volume: 0 };

function dictationMessage(error: DictationError): string {
  switch (error) {
    case 'permission': return t('请在系统设置中允许 Hermes Bot 使用麦克风和语音识别。');
    case 'unavailable': return t('请在 iPhone 设置中开启 Siri 与听写后重试。');
    case 'network': return t('语音识别需要网络，请稍后重试。');
    case 'no-speech': return t('没有听到声音，请再试一次。');
    case 'unsupported-language': return t('当前语言不支持语音识别。');
    case 'interrupted': return t('语音输入被中断，请重试。');
    case 'busy': return t('语音识别正忙，请稍后重试。');
    default: return t('语音输入失败，请重试。');
  }
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
 * it offers answers: a file becomes a message, the microphone fills the draft
 * through the iPhone's speech recognizer, and an @ opens the roster.
 */
export function Composer({ thread, bots, onSend, bottomInset }: ComposerProps) {
  const { styles, C, INK, scheme } = useStyles();
  useTranslation();
  const { stop } = useStore();
  const [draft, setDraft] = useState('');
  const [dictation, setDictation] = useState<DictationState>(IDLE_DICTATION);
  const [attaching, setAttaching] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  // iOS sizes a multiline field to its text by itself; the web preview does not.
  const [webHeight, setWebHeight] = useState(INPUT_MIN);
  const pickerLock = useRef(false);
  const pendingPicker = useRef<'photo' | 'file' | 'camera' | null>(null);
  const mounted = useRef(true);
  const typing = useRef(thread.typing);
  typing.current = thread.typing;
  const input = useRef<TextInputInstance>(null);
  const controller = useRef<ReturnType<typeof createDictation> | null>(null);
  const transcriptRef = useRef('');
  const focused = useIsFocused();
  const dockStyle = [styles.dock, { paddingBottom: Math.max(12, bottomInset) }];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pendingPicker.current = null; };
  }, []);

  useEffect(() => {
    const dictator = createDictation({
      getRecognizer: getDictationRecognizer,
      onState: (state) => {
        transcriptRef.current = state.transcript;
        if (mounted.current) setDictation(state);
      },
      onText: (text) => {
        if (!mounted.current) return;
        setDraft((current) => {
          if (!current) return text;
          const separator = localeTag().startsWith('zh') || /\s$/.test(current) ? '' : ' ';
          return current + separator + text;
        });
      },
      onError: (error) => {
        if (!mounted.current) return;
        // Silence after some words is the normal way a sentence ends.
        if (error === 'no-speech' && transcriptRef.current) return;
        const buttons = error === 'permission'
          ? [
              { text: t('取消'), style: 'cancel' as const },
              { text: t('去设置'), onPress: () => { Linking.openSettings().catch(() => undefined); } },
            ]
          : undefined;
        Alert.alert(t('无法使用语音输入'), dictationMessage(error), buttons);
      },
    });
    controller.current = dictator;
    return () => {
      controller.current = null;
      dictator.dispose();
    };
  }, []);

  // Leaving the chat or the app keeps what was heard so far in the draft.
  useEffect(() => {
    if (!focused) controller.current?.background();
  }, [focused]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') controller.current?.background();
    });
    return () => subscription.remove();
  }, []);

  function startDictation() {
    if (typing.current || dictation.phase !== 'idle') return;
    input.current?.blur();
    Keyboard.dismiss();
    void controller.current?.start(localeTag());
  }

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
    setWebHeight(INPUT_MIN);
    input.current?.blur();
    Keyboard.dismiss();
  }

  const listening = dictation.phase !== 'idle';
  const level = 0.35 + 0.65 * dictation.volume;

  return (
    <View style={dockStyle}>
      {listening ? (
        <View style={styles.recorder} testID="dictation-dock">
          <Pressable
            style={[styles.round, styles.cancel]}
            onPress={() => controller.current?.cancel()}
            accessibilityRole="button"
            accessibilityLabel={t("取消语音输入")}
          >
            <CloseIcon size={15} color={C.recordingInk} />
          </Pressable>
          <Text
            style={[styles.transcript, !dictation.transcript && styles.transcriptHint]}
            numberOfLines={2}
          >
            {dictation.transcript || t("正在聆听")}
          </Text>
          <View style={styles.waveform}>
            {LEVELS.map((height, index) => (
              <View key={index} style={[styles.bar, { height: Math.round(height * level) }]} />
            ))}
          </View>
          <Pressable
            style={[styles.round, styles.sendButton, dictation.phase === 'finishing' && { opacity: 0.5 }]}
            disabled={dictation.phase === 'finishing'}
            onPress={() => controller.current?.finish()}
            accessibilityRole="button"
            accessibilityLabel={t("完成语音输入")}
          >
            <CheckIcon size={17} color={INK.onPaper} />
          </Pressable>
        </View>
      ) : (
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
              style={[styles.input, Platform.OS === 'web' && { height: webHeight }]}
              multiline
              scrollEnabled
              onContentSizeChange={Platform.OS === 'web' ? (event) => {
                const height = Math.ceil(event.nativeEvent.contentSize.height);
                setWebHeight(Math.min(INPUT_MAX, Math.max(INPUT_MIN, height)));
              } : undefined}
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
            ) : (
              <>
                <Pressable
                  style={[styles.button, styles.microphone]}
                  onPress={startDictation}
                  accessibilityRole="button"
                  accessibilityLabel={t("语音输入")}
                >
                  <MicIcon size={16} color={INK.quiet} />
                </Pressable>
                {draft.trim() ? (
                  <Pressable
                    style={[styles.button, styles.cream]}
                    onPress={send}
                    accessibilityRole="button"
                    accessibilityLabel={t("发送")}
                  >
                    <ArrowUpIcon size={17} color={C.bg} />
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        </View>
      </View>
      )}

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
    alignItems: 'flex-end',
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
  input: {
    flex: 1, minWidth: 0, minHeight: INPUT_MIN, maxHeight: INPUT_MAX,
    paddingHorizontal: 9, paddingTop: 7, paddingBottom: 7,
    color: C.text, fontSize: 16, lineHeight: 21, textAlignVertical: 'top',
  },

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

  recorder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  transcript: { flex: 1, minWidth: 0, color: C.recordingInk, fontSize: 15, lineHeight: 20 },
  transcriptHint: { opacity: 0.7 },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    width: 31,
    height: 24,
    overflow: 'hidden',
  },
  bar: { width: 3.2, borderRadius: 2, backgroundColor: C.recordingInk },
}), false);
