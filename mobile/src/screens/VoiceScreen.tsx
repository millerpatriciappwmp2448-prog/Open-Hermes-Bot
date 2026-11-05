import { t, useTranslation } from '../i18n';
import { Linking, ScrollView } from 'react-native';
import { Page } from '../components/Page';
import { Card, Hint, Row, SectionLabel } from '../components/UI';
import { themedStyles } from '../theme';

/**
 * Dictation uses the iPhone's own speech recognition. The words land in the
 * message box first, so nothing is sent until the user taps send.
 */
export function VoiceScreen() {
  const { styles } = useStyles();
  const { language } = useTranslation();

  return (
    <Page title={t('语音')}>
      <ScrollView contentContainerStyle={styles.body}>
        <SectionLabel>{t('语音输入')}</SectionLabel>
        <Card>
          <Row name={t('识别方式')} value={t('iPhone 语音识别')} line chevron={false} />
          <Row name={t('语言')} value={language === 'zh' ? '简体中文' : 'English'} line chevron={false} />
          <Row
            name={t('权限')}
            meta={t('麦克风与语音识别')}
            onPress={() => { Linking.openSettings().catch(() => undefined); }}
          />
        </Card>
        <Hint>{t('识别结果会填入输入框，确认后再发送')}</Hint>
      </ScrollView>
    </Page>
  );
}

const useStyles = themedStyles(() => ({
  body: { paddingHorizontal: 12, paddingBottom: 24 },
}));
