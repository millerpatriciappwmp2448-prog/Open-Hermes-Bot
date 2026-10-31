import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { t, useTranslation } from '../i18n';
import { Page } from '../components/Page';
import { Bloub } from '../components/Bloub';
import { ChevronIcon } from '../components/Icons';
import { ServerModelPicker } from '../components/ServerModelPicker';
import { Hint, PrimaryButton } from '../components/UI';
import { useStore } from '../store';
import { useAppNavigation } from '../nav';
import { themedStyles } from '../theme';

export function ModelsScreen() {
  const { styles } = useStyles();
  useTranslation();
  const { bots, modelPicks, modelOptions, connection } = useStore();
  const navigation = useAppNavigation();
  const [selected, setSelected] = useState('');
  const bot = bots.find(b => b.id === selected);
  return (
    <Page title={t('模型')}>
      {connection.status !== 'connected' ? (
        <View style={styles.body}>
          <Hint>{t('连接服务器后，可为每个智能体选择模型。手机不需要填写模型 API Key。')}</Hint>
          <PrimaryButton label={t('连接服务器')} onPress={() => navigation.navigate('Connection')} />
        </View>
      ) : bot ? (
        <ServerModelPicker key={bot.id} botId={bot.id} onChangeBot={() => setSelected('')} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>{t('智能体的模型')}</Text>
          <Text style={styles.hint}>{t('为每个智能体选择合适的模型')}</Text>
          <View style={styles.list}>{bots.map((b, index) => (
            <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={b.name}
              style={({ pressed }) => [styles.row, index > 0 && styles.line, pressed && styles.pressed]} onPress={() => setSelected(b.id)}>
              <Bloub shape={b.shape} color={b.color} size={32} />
              <View style={styles.copy}><Text style={styles.name}>{b.name}</Text>
                <Text style={styles.meta}>{modelPicks[b.id]?.model || modelOptions[b.id]?.current || t('跟随服务器')}</Text>
              </View>
              <ChevronIcon size={12} />
            </Pressable>
          ))}</View>
          <Text style={styles.hint}>{t('下一条消息生效 · 密钥由服务器管理')}</Text>
        </ScrollView>
      )}
    </Page>
  );
}
const useStyles = themedStyles(({ C }) => ({
  body: { padding: 20, gap: 10 },
  title: { color: C.text, fontSize: 20, fontWeight: '600', marginTop: 8 },
  hint: { color: C.text2, fontSize: 13, lineHeight: 20 },
  list: { backgroundColor: C.cardRaised, borderRadius: 18, marginVertical: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  line: { borderTopWidth: 1, borderTopColor: C.line },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  name: { color: C.text, fontSize: 16, fontWeight: '500' },
  meta: { color: C.text2, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.7 },
}), false);
