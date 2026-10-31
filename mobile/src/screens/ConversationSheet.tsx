import { t, useTranslation } from "../i18n";
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Sheet } from '../components/Sheet';
import { Bloub } from '../components/Bloub';
import { DescriptionEditor, JobsPage, NewJobForm, RunTranscript } from '../components/BotAutomation';
import { ModelList } from '../components/ModelList';
import { ServerModelPicker } from '../components/ServerModelPicker';
import { Toggle } from '../components/Toggle';
import { ConfirmBlock, PrimaryButton, Row, SectionLabel, SheetHeader } from '../components/UI';
import { useStore } from '../store';
import { themedStyles } from '../theme';

type Page = 'main' | 'model' | 'description' | 'jobs' | 'newJob' | 'run';

function preview(text: string | undefined): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return t('未设置');
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

/**
 * What a conversation is, and what can be done to it. The model is per
 * conversation; the memory is the bot's, on the host, and is not touched by
 * anything here. A server bot also says what it is for and what it runs on
 * its own: both live on the server and are read through the bridge.
 */
export function ConversationSheet({
  visible,
  onClose,
  threadId,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  onDeleted: () => void;
}) {
  const { styles } = useStyles();
  useTranslation();
  const { threadById, botById, setModel, clearThread, removeThread, togglePin, connection, loadJobs } =
    useStore();
  const [page, setPage] = useState<Page>('main');
  const [run, setRun] = useState<{ id: string; title: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<'clear' | 'delete' | null>(null);
  const thread = threadById(threadId);
  const bot = thread ? botById(thread.botId) : undefined;
  const online = connection.status === 'connected';
  const serverBot = Boolean(thread?.id.startsWith('bot:'));
  const botId = thread?.botId ?? '';

  // Every opening starts on the summary, with the count read fresh.
  useEffect(() => {
    if (!visible) return;
    setPage('main');
    setRun(null);
    setConfirming(null);
    if (!online || !serverBot || !botId) {
      setJobCount(null);
      return;
    }
    let live = true;
    loadJobs(botId)
      .then((list) => { if (live) setJobCount(list.length); })
      .catch(() => { if (live) setJobCount(null); });
    return () => { live = false; };
  }, [visible, online, serverBot, botId, loadJobs]);

  if (!thread) return null;

  const toMain = () => setPage('main');
  const toJobs = () => setPage('jobs');

  let body;
  if (page === 'model') {
    body = (
      <>
        <SheetHeader
          title={t("模型")}
          sub={serverBot ? undefined : t('演示模型')}
          onClose={onClose}
          back={toMain}
        />
        {serverBot ? <ServerModelPicker key={thread.botId} botId={thread.botId} onPicked={toMain} /> : <ModelList
          selected={thread.threadModel}
          onPick={(picked) => {
            setModel(thread.id, picked);
            toMain();
          }}
        />}
      </>
    );
  } else if (page === 'description') {
    body = (
      <>
        <SheetHeader title={t('描述')} sub={bot?.name} onClose={onClose} back={toMain} />
        <View style={styles.page}><DescriptionEditor botId={botId} /></View>
      </>
    );
  } else if (page === 'jobs') {
    body = (
      <>
        <SheetHeader title={t('定时任务')} sub={bot?.name} onClose={onClose} back={toMain} />
        <View style={styles.page}>
          <JobsPage
            botId={botId}
            reloadKey={reloadKey}
            onCount={setJobCount}
            onNew={() => setPage('newJob')}
            onOpenRun={(picked) => { setRun(picked); setPage('run'); }}
          />
        </View>
      </>
    );
  } else if (page === 'newJob') {
    body = (
      <>
        <SheetHeader title={t('新建定时任务')} sub={bot?.name} onClose={onClose} back={toJobs} />
        <View style={styles.page}>
          <NewJobForm botId={botId} onCreated={() => { setReloadKey((key) => key + 1); toJobs(); }} />
        </View>
      </>
    );
  } else if (page === 'run' && run) {
    body = (
      <>
        <SheetHeader title={run.title} sub={t('运行记录')} onClose={onClose} back={toJobs} />
        <View style={styles.page}><RunTranscript botId={botId} runId={run.id} /></View>
      </>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      {body ?? (
        <>
          <SheetHeader
            title={thread.name}
            sub={t("Hermes 主机 · {0}", {"0": thread.threadModel || t('跟随服务器')})}
            onClose={onClose}
          />
          {confirming ? (
            <ConfirmBlock
              title={
                confirming === 'clear' ? t("清空此会话？") : t("删除此会话？")
              }
              message={
                confirming === 'clear'
                  ? online
                    ? t("将清空本机显示的消息，下一条消息会开启新的服务器会话；机器人的记忆仍保留在服务器上。")
                    : t("将清空当前显示的消息。")
                  : online
                    ? t("将删除服务器上的这个会话，机器人及其记忆仍会保留。")
                    : t("将删除该会话，机器人及其记忆仍会保留。")
              }
              confirmLabel={confirming === 'clear' ? t("清空") : t("删除")}
              onCancel={() => setConfirming(null)}
              onConfirm={() => {
                if (confirming === 'clear') {
                  clearThread(thread.id);
                  setConfirming(null);
                  onClose();
                } else {
                  removeThread(thread.id);
                  setConfirming(null);
                  onClose();
                  onDeleted();
                }
              }}
            />
          ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.face}>
              <Bloub shape={bot?.shape} color={bot?.color ?? '#8b5cf6'} size={54} />
            </View>

            <SectionLabel>{t("会话")}</SectionLabel>
            <View style={styles.card}>
              <Row name={t("模型")} value={thread.threadModel || t('跟随服务器')} onPress={() => setPage('model')} />
              <View style={styles.line} />
              <Row
                name={t("已置顶")}
                chevron={false}
                right={
                  <Toggle
                    on={Boolean(thread.pinned)}
                    onChange={() => togglePin(thread.id)}
                    label={t("已置顶")}
                  />
                }
              />
            </View>

            {serverBot ? (
              <>
                <SectionLabel>{t("机器人")}</SectionLabel>
                <View style={styles.card}>
                  <Row
                    name={t('描述')}
                    meta={online ? preview(bot?.description) : t('请先连接服务器。')}
                    onPress={online ? () => setPage('description') : undefined}
                  />
                  <View style={styles.line} />
                  <Row
                    name={t('定时任务')}
                    meta={
                      online
                        ? jobCount === null ? t('查看') : t('{0} 个任务', { 0: jobCount })
                        : t('请先连接服务器。')
                    }
                    onPress={online ? toJobs : undefined}
                  />
                </View>
              </>
            ) : null}

            <View style={styles.buttons}>
              <PrimaryButton
                label={t("清空会话")}
                tone="quiet"
                onPress={() => setConfirming('clear')}
              />
              <View style={styles.gap} />
              <PrimaryButton
                label={t("删除会话")}
                tone="danger"
                onPress={() => setConfirming('delete')}
              />
            </View>
          </ScrollView>
          )}
        </>
      )}
    </Sheet>
  );
}

const useStyles = themedStyles(({ C }) => ({
  body: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 18, flexShrink: 1 },
  page: { flexShrink: 1 },
  face: { alignItems: 'center', paddingVertical: 10 },
  card: { borderRadius: 13, backgroundColor: C.cardRaised, overflow: 'hidden' },
  line: { height: 1, backgroundColor: C.hairline },
  buttons: { marginTop: 14 },
  gap: { height: 8 },
}));
