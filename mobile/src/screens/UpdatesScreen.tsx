import { ScrollView, View } from 'react-native';
import appConfig from '../../app.json';
import { Page } from '../components/Page';
import { Card, Hint, Row, SectionLabel } from '../components/UI';
import { t, useTranslation } from '../i18n';
import { themedStyles } from '../theme';

export function UpdatesScreen() {
  const { styles } = useStyles();
  useTranslation();
  return (
    <Page title={t('更新')}>
      <ScrollView contentContainerStyle={styles.body}>
        <SectionLabel>{t('当前应用')}</SectionLabel>
        <Card>
          <Row name={t('版本')} value={`${appConfig.expo.version} (${appConfig.expo.ios.buildNumber})`} chevron={false} />
          <View style={styles.line} />
          <Row name={t('更新方式')} value={t('手动')} chevron={false} />
        </Card>
        <Hint>{t('通过巨魔导入新版 IPA，覆盖安装即可更新。')}</Hint>
      </ScrollView>
    </Page>
  );
}

const useStyles = themedStyles(({ C }) => ({
  body: { paddingHorizontal: 12, paddingBottom: 24 },
  line: { height: 1, backgroundColor: C.hairline },
}));
