import webpush from "web-push";

export function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push 环境变量尚未配置");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return webpush;
}

export function asWebPushSubscription(record: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  return {
    endpoint: record.endpoint,
    keys: { p256dh: record.p256dh, auth: record.auth },
  };
}
