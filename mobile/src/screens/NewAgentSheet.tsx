import { t, useTranslation } from "../i18n";
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Sheet } from '../components/Sheet';
import { Bloub } from '../components/Bloub';
import { BackIcon, ChevronIcon, CloseIcon } from '../components/Icons';
import { ModelList } from '../components/ModelList';
import { COLORS, DEFAULT_MODEL, SHAPES } from '../data';
import type { BloubShape } from '../bloubFrames';
import { useStore } from '../store';
import { themedStyles } from '../theme';

/**
 * The create sheet. A bot keeps its own memory, its own session, and the
 * face picked here; a group brings a few of them into one conversation,
 * each with its session untouched.
 */
export function NewAgentSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (threadId: string) => void;
}) {
  const { styles, INK, scheme } = useStyles();
  useTranslation();
  const { bots, prefs, connection, addBot, addGroup } = useStore();
  const online = connection.status === 'connected';
  const window = useWindowDimensions();
  const [tab, setTab] = useState<'bot' | 'group'>('bot');
  const [name, setName] = useState('Atlas');
  const [shape, setShape] = useState<BloubShape>('capsule');
  const [color, setColor] = useState(COLORS[0]);
  const [model, setModel] = useState(prefs.defaultModel);
  const [pickingModel, setPickingModel] = useState(false);
  const [members, setMembers] = useState<string[]>(['atlas', 'june', 'chief']);

  const ready = name.trim().length > 0 && (tab === 'bot' || members.length > 1);

  function create() {
    if (!ready) return;
    const id =
      tab === 'bot'
        ? addBot({ name, shape, color, model })
        : addGroup({ name: name || t("团队"), members, model });
    onClose();
    onCreated?.(id);
    setTab('bot');
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <Text style={styles.title}>{pickingModel ? t("模型") : t("新建智能体")}</Text>
          <Text style={styles.sub}>
            {pickingModel
              ? t("仅用于当前会话，智能体的记忆保持不变。")
              : tab === 'bot'
                ? t("创建智能体，或将多个智能体组成群组。")
                : t("让多个智能体加入同一会话。")}
          </Text>
        </View>
        <Pressable
          style={styles.close}
          onPress={() => (pickingModel ? setPickingModel(false) : onClose())}
          accessibilityLabel={pickingModel ? t("返回") : t("关闭")}
        >
          {pickingModel ? <BackIcon size={15} color={INK.quiet} /> : <CloseIcon />}
        </Pressable>
      </View>

      {pickingModel ? (
        <View style={[styles.picker, { height: Math.round(window.height * 0.45) }]}>
          <ModelList
            selected={model}
            onPick={(picked) => {
              setModel(picked);
              setPickingModel(false);
            }}
          />
        </View>
      ) : (
        <>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            <View style={styles.segmented}>
              {(['bot', 'group'] as const).map((entry) => (
                <Pressable
                  key={entry}
                  style={[styles.segment, tab === entry && styles.segmentActive]}
                  onPress={() => setTab(entry)}
                >
                  <Text style={[styles.segmentText, tab === entry && styles.segmentTextActive]}>
                    {entry === 'bot' ? t("智能体") : t("群组")}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.preview}>
              <Bloub shape={shape} color={color} size={56} />
              <View style={styles.nameField}>
                <Text style={styles.fieldLabel}>{tab === 'bot' ? t("智能体名称") : t("群组名称")}</Text>
                <TextInput keyboardAppearance={scheme}
                  value={name}
                  onChangeText={setName}
                  style={styles.fieldValue}
                  placeholder={t("名称")}
                  placeholderTextColor={INK.quiet}
                  autoCorrect={false}
                  returnKeyType="done"
                />
              </View>
            </View>
            <Text style={styles.hint}>
              {tab === 'bot'
                ? online ? t("将在 {0} 上创建“{1}”的 Hermes 配置。", {"0": prefs.host, "1": name.trim() || t("智能体")}) : t('当前未连接服务器，仅创建演示智能体。')
                : t("每个成员独立回复，也可通过 @ 提及其他成员并交接任务。")}
            </Text>

            {tab === 'bot' ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.label}>{t("形状")}</Text>
                  <View style={styles.shapeGrid}>
                    {SHAPES.map((option) => (
                      <Pressable
                        key={option.id}
                        style={[styles.shapeOption, shape === option.id && styles.shapeActive]}
                        onPress={() => setShape(option.id)}
                        accessibilityLabel={t(option.label)}
                      >
                        <Bloub shape={option.id} color="#9a9aa2" size={22} />
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.label}>{t("颜色")}</Text>
                  <View style={styles.colorGrid}>
                    {COLORS.map((dot) => (
                      <Pressable
                        key={dot}
                        onPress={() => setColor(dot)}
                        style={[
                          styles.dot,
                          { backgroundColor: dot },
                          color === dot && styles.dotActive,
                        ]}
                        accessibilityLabel={t("颜色 {0}", {"0": dot})}
                      />
                    ))}
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.section}>
                <Text style={styles.label}>{t("成员")}</Text>
                <View style={styles.card}>
                  {bots.map((bot, index) => {
                    const on = members.includes(bot.id);
                    return (
                      <Pressable
                        key={bot.id}
                        style={[styles.row, index > 0 && styles.rowLine]}
                        onPress={() =>
                          setMembers((current) =>
                            current.includes(bot.id)
                              ? current.filter((id) => id !== bot.id)
                              : [...current, bot.id],
                          )
                        }
                      >
                        <Bloub shape={bot.shape} color={bot.color} size={26} />
                        <View style={styles.rowCopy}>
                          <Text style={styles.rowName}>{bot.name}</Text>
                          <Text style={styles.rowMeta}>{bot.role} {t("· 会话")} {bot.session}</Text>
                        </View>
                        <View style={[styles.check, on && styles.checkOn]}>
                          {on ? <Text style={styles.checkMark}>✓</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.label}>{t("模型")}</Text>
              <View style={styles.card}>
                <Pressable style={styles.row} disabled={online} onPress={() => setPickingModel(true)}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowName}>{online ? t('继承服务器配置') : model}</Text>
                    <Text style={styles.rowMeta}>{online ? t('创建后可在智能体详情中选择模型。') : t('演示模型')}</Text>
                  </View>
                  {!online ? <ChevronIcon /> : null}
                </Pressable>
              </View>
            </View>

            <Text style={styles.hint}>
              {t("每个智能体都有独立的记忆、会话和你选择的外观。")}
            </Text>
          </ScrollView>

          <View style={styles.foot}>
            <Pressable
              style={[styles.primary, !ready && styles.primaryOff]}
              onPress={create}
              disabled={!ready}
            >
              <Text style={styles.primaryText}>{tab === 'bot' ? t("创建智能体") : t("创建群组")}</Text>
            </Pressable>
          </View>
        </>
      )}
    </Sheet>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingTop: 12, paddingHorizontal: 16 },
  headCopy: { flex: 1 },
  title: { color: C.text, fontSize: 19, fontWeight: '600', letterSpacing: -0.48 },
  sub: { marginTop: 3, color: INK.quiet, fontSize: 11, lineHeight: 15 },
  close: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: C.field2 },

  body: { flexShrink: 1 },
  picker: { flexShrink: 1 },
  bodyContent: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8 },

  segmented: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: 9, backgroundColor: C.field },
  segment: { flex: 1, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segmentActive: { backgroundColor: C.field2 },
  segmentText: { color: INK.quiet, fontSize: 12, fontWeight: '500' },
  segmentTextActive: { color: C.text },

  preview: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 14 },
  nameField: { flex: 1 },
  fieldLabel: { color: INK.quiet, fontSize: 9, fontWeight: '500' },
  fieldValue: {
    height: 34,
    marginTop: 3,
    paddingHorizontal: 10,
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 9,
    backgroundColor: C.card,
    color: C.text,
    fontSize: 14,
    fontWeight: '500',
  },
  hint: { marginTop: 7, color: INK.quiet, fontSize: 10, lineHeight: 14 },

  section: { marginTop: 14 },
  label: { marginBottom: 7, color: INK.quiet, fontSize: 9, fontWeight: '600', letterSpacing: 0.9, textTransform: 'uppercase' },
  shapeGrid: { flexDirection: 'row', gap: 4 },
  shapeOption: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: C.card },
  shapeActive: { backgroundColor: C.field2, borderWidth: 1, borderColor: C.strongBorder },
  colorGrid: { flexDirection: 'row', gap: 8 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: C.border },
  dotActive: { borderWidth: 2, borderColor: C.paper },

  card: { overflow: 'hidden', borderRadius: 11, backgroundColor: C.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, paddingHorizontal: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: C.hairline },
  rowCopy: { flex: 1 },
  rowName: { color: C.text, fontSize: 12, fontWeight: '500' },
  rowMeta: { color: INK.quiet, fontSize: 9 },
  check: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.strongBorder },
  checkOn: { backgroundColor: C.paper, borderColor: C.paper },
  checkMark: { color: INK.onPaper, fontSize: 11, fontWeight: '700' },

  foot: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 10 },
  primary: { height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: C.paper },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: INK.onPaper, fontSize: 14, fontWeight: '600' },
}));
