import { t, useTranslation } from "../i18n";
import { ScrollView, StyleSheet, View } from 'react-native';
import { Page } from '../components/Page';
import { ModelList } from '../components/ModelList';
import { Card, Hint, Row, SectionLabel } from '../components/UI';
import { useStore } from '../store';
import { C, createStyles } from '../theme';

/**
 * The model a new conversation starts on. A conversation can still be moved
 * to another one from its own details; the bot's memory is untouched either
 * way.
 */
export function ModelsScreen() {
  useTranslation();
  const { prefs, setPref } = useStore();

  return (
    <Page title={t("模型")}>
      <ScrollView contentContainerStyle={styles.body}>
        <SectionLabel>{t("新会话")}</SectionLabel>
        <Card>
          <Row name={t("默认模型")} value={prefs.defaultModel} chevron={false} />
        </Card>

        <SectionLabel>{t("所有模型")}</SectionLabel>
        <View style={styles.list}>
          <ModelList selected={prefs.defaultModel} onPick={(picked) => setPref('defaultModel', picked)} />
        </View>

        <Hint>
          {t("当前模型列表为演示内容，选择仅影响应用内显示。实际回复使用服务器当前配置的模型。")}
        </Hint>
      </ScrollView>
    </Page>
  );
}

const styles = createStyles({
  body: { paddingHorizontal: 12, paddingBottom: 24 },
  list: { height: 420, borderRadius: 13, backgroundColor: C.cardRaised, overflow: 'hidden', paddingTop: 2 },
});
