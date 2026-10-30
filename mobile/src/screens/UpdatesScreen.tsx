import { t, useTranslation } from "../i18n";
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Page } from '../components/Page';
import { Card, Hint, PrimaryButton, Row, SectionLabel } from '../components/UI';
import { Toggle } from '../components/Toggle';
import { HOST } from '../data';
import { useStore } from '../store';
import { C, createStyles } from '../theme';

type Check = 'idle' | 'checking' | 'current';

/**
 * The version, and the look for the next one. The check is simulated: the
 * app looks at nothing, and no build is downloaded.
 */
export function UpdatesScreen() {
  useTranslation();
  const { prefs, setPref } = useStore();
  const [check, setCheck] = useState<Check>('idle');

  useEffect(() => {
    if (check !== 'checking') return;
    const timer = setTimeout(() => setCheck('current'), 1100);
    return () => clearTimeout(timer);
  }, [check]);

  const word =
    check === 'checking' ? t("正在检查…") : check === 'current' ? t("已是最新版本") : t("尚未检查");

  return (
    <Page title={t("更新")}>
      <ScrollView contentContainerStyle={styles.body}>
        <SectionLabel>{t("当前应用")}</SectionLabel>
        <Card>
          <Row name={t("版本")} value={HOST.version} chevron={false} />
          <View style={styles.line} />
          <Row name={t("服务器")} value={`Hermes ${HOST.version}`} chevron={false} />
          <View style={styles.line} />
          <Row
            name={t("状态")}
            value={word}
            valueColor={check === 'current' ? '#7fcfaa' : undefined}
            chevron={false}
          />
        </Card>

        <View style={styles.buttons}>
          <PrimaryButton
            label={check === 'checking' ? t("正在检查…") : t("检查更新")}
            onPress={() => setCheck('checking')}
          />
        </View>

        <SectionLabel>{t("发现更新时")}</SectionLabel>
        <Card>
          <Row
            name={t("后台下载")}
            meta={t("关闭应用后应用更新")}
            chevron={false}
            right={
              <Toggle
                on={prefs.autoUpdate}
                onChange={() => setPref('autoUpdate', !prefs.autoUpdate)}
                label={t("自动更新")}
              />
            }
          />
        </Card>

        <Hint>
          {t("此处为演示功能，不会实际下载或安装更新。手机端请通过巨魔导入新版 IPA 更新。")}
        </Hint>
      </ScrollView>
    </Page>
  );
}

const styles = createStyles({
  body: { paddingHorizontal: 12, paddingBottom: 24 },
  line: { height: 1, backgroundColor: C.hairline },
  buttons: { marginTop: 16 },
});
