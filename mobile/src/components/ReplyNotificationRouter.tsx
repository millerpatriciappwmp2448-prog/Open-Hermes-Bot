import { useEffect, useRef, useState } from 'react';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { RootStackParamList } from '../nav';
import { useStore } from '../store';
import { normalizeUrl } from '../api';
import { clearReplyNotificationResponse, listenForReplyNotification } from '../notificationDevice';
import type { ReplyNotification } from '../replyNotifications';

/** Wait for pairing restore before resolving a notification's host-owned IDs. */
export function ReplyNotificationRouter({ navigation, ready }: {
  navigation: NavigationContainerRefWithCurrent<RootStackParamList>; ready: boolean;
}) {
  const { connection, threads } = useStore();
  const [pending, setPending] = useState<ReplyNotification | null>(null);
  const handled = useRef(new Set<string>());
  useEffect(() => listenForReplyNotification(setPending), []);
  useEffect(() => {
    if (!pending || !ready || !navigation.isReady() || connection.status !== 'connected') return;
    const key = JSON.stringify([pending.host, pending.sessionId, pending.requestId]);
    const thread = threads.find(row => row.id === pending.threadId && row.botId === pending.botId);
    if (!handled.current.has(key) && normalizeUrl(connection.url) === pending.host && thread) {
      handled.current.add(key);
      if (thread.sessionId === pending.sessionId) navigation.navigate('Chat', { threadId: thread.id });
      else navigation.navigate('SessionTranscript', { botId: pending.botId, sessionId: pending.sessionId, title: thread.name });
    }
    setPending(null);
    void clearReplyNotificationResponse().catch(() => {});
  }, [connection.status, connection.url, navigation, pending, ready, threads]);
  return null;
}
