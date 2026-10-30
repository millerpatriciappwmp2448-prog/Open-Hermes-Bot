import { t, useTranslation } from "../i18n";
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Page } from '../components/Page';
import { Bloub } from '../components/Bloub';
import { Card, Field, Hint, PrimaryButton, Row, SectionLabel } from '../components/UI';
import { COLORS, SHAPES } from '../data';
import type { BloubShape } from '../bloubFrames';
import { useStore } from '../store';
import { useAppNavigation } from '../nav';
import { themedStyles } from '../theme';

/**
 * The setup, walked by hand: pair the phone with the bridge, then make the
 * first bot. A bot made here is a Hermes profile, on the host; without a
 * bridge, it is the app's own, until the window closes.
 */
export function SetupScreen() {
  const { styles } = useStyles();
  useTranslation();
  const navigation = useAppNavigation();
  const { prefs, connection, addBot } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('Atlas');
  const [shape, setShape] = useState<BloubShape>('capsule');
  const [color, setColor] = useState(COLORS[0]);

  const ready = name.trim().length > 0;

  return (
    <Page title={t("初始设置")}>
      <View style={styles.progress}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={[styles.pip, index <= step && styles.pipOn]} />
        ))}
      </View>

      {step === 0 ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>{t("初始设置 · 第 1 步，共 3 步")}</Text>
          <Text style={styles.title}>{t("连接你的 Hermes")}</Text>
          <Text style={styles.lead}>{t("通过服务器上的桥接服务和配对码连接本机。")}</Text>

          <SectionLabel>{t("连接")}</SectionLabel>
          <Card>
            <View style={styles.card}>
              <Row
                name={t("桥接服务")}
                value={connection.status === 'connected' ? prefs.host : t("未连接")}
                onPress={() => navigation.navigate('Connection')}
              />
            </View>
          </Card>

          <View style={styles.buttons}>
            <PrimaryButton
              label={
                connection.status === 'connected'
                  ? t("继续")
                  : t("打开连接设置")
              }
              onPress={() =>
                connection.status === 'connected'
                  ? setStep(1)
                  : navigation.navigate('Connection')
              }
            />
          </View>
          <Hint>
            {t("会话内容保存在服务器上。手机仅持有桥接服务的设备令牌，Hermes 密钥始终留在服务器。")}
          </Hint>
        </ScrollView>
      ) : null}

      {step === 1 ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>{t("第一个机器人 · 第 2 步，共 3 步")}</Text>
          <Text style={styles.title}>{t("给它起个名字")}</Text>
          <Text style={styles.lead}>{t("设置你希望使用的机器人名称。")}</Text>

          <View style={styles.preview}>
            <Bloub shape={shape} color={color} size={64} />
            <View style={styles.nameField}>
              <Field label={t("机器人名称")} value={name} onChange={setName} placeholder="Atlas" />
            </View>
          </View>

          <SectionLabel>{t("形状")}</SectionLabel>
          <View style={styles.shapeGrid}>
            {SHAPES.map((option) => (
              <Pressable
                key={option.id}
                style={[styles.shape, shape === option.id && styles.shapeOn]}
                onPress={() => setShape(option.id)}
                accessibilityLabel={t(option.label)}
              >
                <Bloub shape={option.id} color="#9a9aa2" size={22} />
              </Pressable>
            ))}
          </View>

          <SectionLabel>{t("颜色")}</SectionLabel>
          <View style={styles.colors}>
            {COLORS.map((dot) => (
              <Pressable
                key={dot}
                onPress={() => setColor(dot)}
                style={[styles.dot, { backgroundColor: dot }, color === dot && styles.dotOn]}
                accessibilityLabel={t("颜色 {0}", {"0": dot})}
              />
            ))}
          </View>

          <View style={styles.buttons}>
            <PrimaryButton
              label={ready ? t("创建机器人") : t("请先填写名称")}
              onPress={() => {
                if (!ready) return;
                addBot({ name, shape, color, model: prefs.defaultModel });
                setStep(2);
              }}
            />
            <View style={styles.gap} />
            <PrimaryButton label={t("返回")} tone="quiet" onPress={() => setStep(0)} />
          </View>
        </ScrollView>
      ) : null}

      {step === 2 ? (
        <View style={[styles.body, styles.done]}>
          <Bloub shape={shape} color={color} size={86} />
          <Text style={styles.doneTitle}>{t("设置完成")}</Text>
          <Text style={styles.doneCopy}>
            {name || t("你的机器人")} {t("已创建于")} {prefs.host}{t("。Hermes 会保存它的记忆、外观和会话。")}
          </Text>
          <View style={styles.buttons}>
            <PrimaryButton label={t("开始使用")} onPress={() => navigation.navigate('Chats')} />
            <View style={styles.gap} />
            <PrimaryButton label={t("重新设置")} tone="quiet" onPress={() => setStep(0)} />
          </View>
        </View>
      ) : null}
    </Page>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  pip: { flex: 1, height: 3, borderRadius: 2, backgroundColor: C.field2 },
  pipOn: { backgroundColor: C.paper },
  body: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 24 },
  eyebrow: {
    color: INK.quiet,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.04,
    textTransform: 'uppercase',
  },
  title: { marginTop: 6, color: C.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.8 },
  lead: { marginTop: 4, color: INK.quiet, fontSize: 12 },
  card: { padding: 12 },
  label: { marginTop: 10, marginBottom: 3, color: INK.quiet, fontSize: 9, fontWeight: '500' },
  buttons: { marginTop: 16 },
  gap: { height: 8 },

  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16 },
  nameField: { flex: 1 },
  shapeGrid: { flexDirection: 'row', gap: 4 },
  shape: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: C.card,
  },
  shapeOn: { backgroundColor: C.field2, borderWidth: 1, borderColor: C.strongBorder },
  colors: { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: C.border },
  dotOn: { borderWidth: 2, borderColor: C.paper },

  done: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  doneTitle: { marginTop: 16, color: C.text, fontSize: 22, fontWeight: '600', letterSpacing: -0.5 },
  doneCopy: {
    marginTop: 6,
    marginBottom: 4,
    maxWidth: 260,
    color: INK.quiet,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
}));
