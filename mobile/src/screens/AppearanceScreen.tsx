import { t, useTranslation } from "../i18n";
import { ScrollView, StyleSheet } from 'react-native';
import { Page } from '../components/Page';
import { Card, Hint, Row, SectionLabel } from '../components/UI';
import { useStore } from '../store';
import { createStyles } from '../theme';

/**
 * How the app looks. The theme is dark by construction — the palette is the
 * window's own — and a page replaces the one before it without a transition,
 * so there is no motion left to switch off.
 */
export function AppearanceScreen() {
  useTranslation();
  const { toggles } = useStore();

  return (
    <Page title={t("外观")}>
      <ScrollView contentContainerStyle={styles.body}>
        <SectionLabel>{t("主题")}</SectionLabel>
        <Card>
          <Row name={t("深色")} value={t("唯一主题")} chevron={false} />
        </Card>
        <Hint>
          {t("Hermes Bot 的桌面端和手机端均采用深色主题，目前尚未提供浅色主题。")}
        </Hint>

        <SectionLabel>{t("触感反馈")}</SectionLabel>
        <Card>
          <Row name={t("跟随应用设置")} value={toggles.haptics ? t("开启") : t("关闭")} chevron={false} />
        </Card>
      </ScrollView>
    </Page>
  );
}

const styles = createStyles({
  body: { paddingHorizontal: 12, paddingBottom: 24 },
});
