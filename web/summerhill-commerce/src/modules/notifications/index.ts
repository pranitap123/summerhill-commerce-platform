// Public API of the notifications module.
export {
  handleOrderNotification,
  handleAlertNotification,
  sendOrderLookupLink,
  orderUrl,
  NOTIFY_QUEUE,
  ALERT_NOTIFY_QUEUE,
} from './service'
export { getMailer, setMailerForTests } from './mailer'
export type { Mail, Mailer } from './mailer'
