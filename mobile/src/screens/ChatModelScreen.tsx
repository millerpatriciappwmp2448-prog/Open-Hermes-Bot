import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Page } from '../components/Page';
import { ModelList } from '../components/ModelList';
import { ServerModelPicker } from '../components/ServerModelPicker';
import { Hint, PrimaryButton } from '../components/UI';
import { t, useTranslation } from '../i18n';
import type { RootStackParamList } from '../nav';
import { useStore } from '../store';

export function ChatModelScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'ChatModel'>) {
  useTranslation();
  const { threadById, connection, setModel } = useStore();
  const thread = threadById(route.params.threadId);
  const server = Boolean(thread?.id.startsWith('bot:'));
  return (
    <Page title={t('模型')}>
      {!thread ? <Hint>{t('此会话已不存在')}</Hint> : server ? (
        connection.status === 'connected'
          ? <ServerModelPicker botId={thread.botId} onPicked={() => navigation.goBack()} />
          : <><Hint>{t('请先连接服务器。')}</Hint><PrimaryButton label={t('连接服务器')} onPress={() => navigation.navigate('Connection')} /></>
      ) : <ModelList selected={thread.threadModel} onPick={model => { setModel(thread.id, model); navigation.goBack(); }} />}
    </Page>
  );
}
