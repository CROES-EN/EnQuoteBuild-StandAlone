import {parseNotificationTimestamp} from "./notificationTimestamp.js";

function recordedActor(value) {
  const actor = typeof value === "string" ? value.trim() : "";
  return actor && !actor.toLowerCase().endsWith("@example.invalid") ? actor : null;
}

export function notificationActor(notification) {
  return recordedActor(notification.changedBy)
    || recordedActor(notification.last_updated_by)
    || recordedActor(notification.updated_by);
}

export function withQuoteAttribution(notification, quote) {
  if (notificationActor(notification) || !quote) return notification;
  const eventAt = parseNotificationTimestamp(notification.occurredAt);
  const quoteAt = parseNotificationTimestamp(quote.updated_date || quote.updated_at || quote.last_saved_at);
  if (!Number.isFinite(eventAt) || eventAt !== quoteAt) return notification;
  const updater = recordedActor(quote.last_updated_by) || recordedActor(quote.updated_by);
  if (updater) return {...notification, changedBy: updater};
  const history = Array.isArray(quote.status_history) ? quote.status_history : [];
  const last = history[history.length - 1];
  const changedBy = recordedActor(last?.changed_by);
  const changedAt = parseNotificationTimestamp(last?.changed_at);
  if (!changedBy || !Number.isFinite(changedAt) || changedAt > eventAt) return notification;
  // This identifies the latest status author, not necessarily the latest field editor.
  return {...notification, changedBy, attributionSource: "status_history"};
}
