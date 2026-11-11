import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { Page } from '../components/Page';
import { ModelList } from '../components/ModelList';
import { ServerModelPicker } from '../components/ServerModelPicker';
import { Hint, PrimaryButton } from '../components/UI';
import { t, useTranslation } from '../i18n';
import type { RootStackParamList } from '../nav';
import { useStore } from '../store';
import { themedStyles } from '../theme';

export function ChatModelScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ChatModel'>) {
  useTranslation();
  const { styles } = useStyles();
  const { threadById, botById, connection, setModel, modelPicks, modelOptions } = useStore();
  const [member, setMember] = useState<string | null>(null);
  const thread = threadById(route.params.threadId);
  const server = Boolean(thread?.id.startsWith('bot:') || thread?.groupId);
  const group = Boolean(thread?.kind === 'group' && thread.groupId);
  const selectedMember = member && thread?.members?.includes(member) ? member : null;
  return (
    <Page title={t('模型')} right={group && selectedMember ? <Pressable style={styles.done} onPress={() => setMember(null)}>
      <Text style={styles.name}>{t('返回')}</Text></Pressable> : undefined}>
      {!thread ? <Hint>{t('此会话已不存在')}</Hint> : server ? (
        connection.status === 'connected'
          ? group && !selectedMember ? <ScrollView contentContainerStyle={styles.members}>
            {(thread.members || []).map(id => <Pressable key={id} style={styles.row} accessibilityRole="button" onPress={() => setMember(id)}>
              <Text style={styles.name}>{botById(id)?.name || id}</Text>
              <Text style={styles.model} numberOfLines={2}>{modelPicks[id]?.model || modelOptions[id]?.current || t('跟随服务器')}</Text>
            </Pressable>)}
          </ScrollView> : <ServerModelPicker botId={selectedMember || thread.botId} onPicked={() => group ? setMember(null) : navigation.goBack()} />
          : <><Hint>{t('请先连接服务器。')}</Hint><PrimaryButton label={t('连接服务器')} onPress={() => navigation.navigate('Connection')} /></>
      ) : <ModelList selected={thread.threadModel} onPick={model => { setModel(thread.id, model); navigation.goBack(); }} />}
    </Page>
  );
}

const useStyles = themedStyles(({ C }) => ({
  members: { padding: 16, gap: 8 },
  row: { backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 5 },
  name: { color: C.text, fontSize: 14, fontWeight: '500' },
  model: { color: C.text2, fontSize: 12 },
  done: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
}), false);
