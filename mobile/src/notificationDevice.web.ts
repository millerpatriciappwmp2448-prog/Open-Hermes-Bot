import type { ReplyNotification } from './replyNotifications';
export type NotificationAccess = 'allowed' | 'undetermined' | 'denied' | 'unsupported' | 'unavailable';
export const notificationsSupported = false;
export async function notificationAccess(_request = false): Promise<NotificationAccess> { return 'unsupported'; }
export function installReplyNotificationHandler(_visible: (notice: ReplyNotification) => boolean) { return () => {}; }
export async function presentReplyNotification(_notice: ReplyNotification) {}
export function listenForReplyNotification(_open: (notice: ReplyNotification) => void) { return () => {}; }
export async function clearReplyNotificationResponse() {}
