import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t } from './i18n';
import { notificationTarget, type ReplyNotification } from './replyNotifications';

export type NotificationAccess = 'allowed' | 'undetermined' | 'denied' | 'unsupported' | 'unavailable';
export const notificationsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

function access(status: Notifications.NotificationPermissionsStatus): NotificationAccess {
  if (status.ios) {
    if ([Notifications.IosAuthorizationStatus.AUTHORIZED, Notifications.IosAuthorizationStatus.PROVISIONAL,
      Notifications.IosAuthorizationStatus.EPHEMERAL].includes(status.ios.status)) return 'allowed';
    return status.ios.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED ? 'undetermined' : 'denied';
  }
  return status.granted ? 'allowed' : status.canAskAgain ? 'undetermined' : 'denied';
}

export async function notificationAccess(request = false): Promise<NotificationAccess> {
  if (!notificationsSupported) return 'unsupported';
  try {
    let result = await Notifications.getPermissionsAsync();
    if (request && access(result) === 'undetermined') {
      if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('replies', {
        name: t('智能体回复'), importance: Notifications.AndroidImportance.DEFAULT,
      });
      result = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
    return access(result);
  } catch { return 'unavailable'; }
}

export function installReplyNotificationHandler(visible: (notice: ReplyNotification) => boolean) {
  if (!notificationsSupported) return () => {};
  Notifications.setNotificationHandler({ handleNotification: async notification => {
    const notice = notificationTarget(notification.request.content.data);
    const show = Boolean(notice && visible(notice));
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  } });
  return () => Notifications.setNotificationHandler(null);
}

export async function presentReplyNotification(notice: ReplyNotification) {
  return Notifications.scheduleNotificationAsync({
    identifier: JSON.stringify([notice.host, notice.botId, notice.sessionId, notice.requestId]),
    content: { title: notice.name, body: t('回复已完成'), sound: 'default', data: { ...notice } },
    trigger: Platform.OS === 'android' ? { channelId: 'replies' } : null,
  });
}

export function listenForReplyNotification(open: (notice: ReplyNotification) => void) {
  if (!notificationsSupported) return () => {};
  const accept = (response: Notifications.NotificationResponse | null) => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const notice = notificationTarget(response.notification.request.content.data);
    if (notice) open(notice);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(accept);
  try { accept(Notifications.getLastNotificationResponse()); } catch { /* Older native modules may not have a stored response. */ }
  return () => subscription.remove();
}

export async function clearReplyNotificationResponse() {
  await Notifications.clearLastNotificationResponseAsync();
}
