import { browserAlerts } from './alert-queue';

/** React Native Web's built-in Alert is empty; the browser host owns this UI. */
export const Alert = { alert: browserAlerts.alert };
