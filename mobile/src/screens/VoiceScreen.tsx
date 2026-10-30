import { t, useTranslation } from "../i18n";
import { ScrollView, Text, View } from 'react-native';
import { Page } from '../components/Page';
import { Card, Hint, Row, SectionLabel, Segmented } from '../components/UI';
import { useStore } from '../store';
import { themedStyles } from '../theme';

/**
 * Where a dictation becomes words. Both answers are simulated: nothing is
 * recorded and no audio leaves the phone either way.
 */
export function VoiceScreen() {
  const { styles } = useStyles();
  useTranslation();
  const { prefs, setPref } = useStore();

  return (
    <Page title={t("语音")}>
      <ScrollView contentContainerStyle={styles.body}>
        <SectionLabel>{t("语音转写")}</SectionLabel>
        <Card>
          <View style={styles.card}>
            <Segmented
              options={[
                { id: 'host' as const, label: t("Hermes 主机") },
                { id: 'device' as const, label: t("在本机上") },
              ]}
              value={prefs.voice}
              onChange={(voice) => setPref('voice', voice)}
            />
            <Text style={styles.note}>
              {prefs.voice === 'host'
                ? t("由 Hermes 主机转写 · 当前为演示功能")
                : t("在本机转写 · 当前为演示功能")}
            </Text>
          </View>
        </Card>

        <SectionLabel>{t("转写位置说明")}</SectionLabel>
        <Card>
          <Row name={t("主机")} meta={t("由运行 Hermes 的服务器处理音频")} chevron={false} />
          <View style={styles.line} />
          <Row name={t("设备")} meta={t("由手机转为文字，不向服务器发送音频")} chevron={false} />
        </Card>

        <Hint>
          {t("当前语音功能仅演示计时和语音消息，不会开启麦克风或录制音频。")}
        </Hint>

        <SectionLabel>{t("语言")}</SectionLabel>
        <Card>
          <Row name={t("跟随主机设置")} value={t("由主机决定")} chevron={false} />
        </Card>
      </ScrollView>
    </Page>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  body: { paddingHorizontal: 12, paddingBottom: 24 },
  card: { padding: 12 },
  note: { marginTop: 10, color: INK.quiet, fontSize: 10, textAlign: 'center' },
  line: { height: 1, backgroundColor: C.hairline },
}));
