import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { t, useTranslation } from '../i18n';
import { Page } from '../components/Page';
import { ServerModelPicker } from '../components/ServerModelPicker';
import { Card, Hint, PrimaryButton, Row, SectionLabel } from '../components/UI';
import { useStore } from '../store';
import { useAppNavigation } from '../nav';
import { C, createStyles } from '../theme';

/**
 * The model a new conversation starts on. A conversation can still be moved
 * to another one from its own details; the bot's memory is untouched either
 * way.
 */
export function ModelsScreen() {
  useTranslation();
  const { bots, modelPicks, modelOptions, connection } = useStore();
  const navigation = useAppNavigation();
  const [selected, setSelected] = useState('');
  const bot = bots.find(b => b.id === selected);

  return (
    <Page title={t("模型")}>
      {connection.status !== 'connected' ? (
        <View style={styles.body}>
          <Hint>{t('连接服务器后，可为每个机器人选择模型。手机不需要填写模型 API Key。')}</Hint>
          <PrimaryButton label={t('连接服务器')} onPress={() => navigation.navigate('Connection')} />
        </View>
      ) : bot ? (
        <View style={styles.picker}>
          <View style={styles.body}>
            <PrimaryButton label={t('选择其他机器人')} tone="quiet" onPress={() => setSelected('')} />
            <Text style={styles.name}>{bot.name}</Text>
          </View>
          <ServerModelPicker key={bot.id} botId={bot.id} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <SectionLabel>{t('机器人的模型')}</SectionLabel>
          <Card>{bots.map((b, index) => (
            <Row key={b.id} name={b.name} line={index > 0}
              meta={modelPicks[b.id]?.model || modelOptions[b.id]?.current || t('跟随服务器')}
              onPress={() => setSelected(b.id)} />
          ))}</Card>
          <Hint>{t('每个机器人分别选择模型。模型服务地址和密钥均由服务器管理。')}</Hint>
        </ScrollView>
      )}
    </Page>
  );
}

const styles = createStyles({
  body: { padding: 12 },
  picker: { flex: 1, minHeight: 0 },
  name: { color: C.text, fontSize: 16, marginTop: 12 },
});
