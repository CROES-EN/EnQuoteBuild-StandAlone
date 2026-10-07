const {createHash} = require("node:crypto");
const {parseRecordTimestamp} = require("./quoteAttribution.cjs");

const SYNC_FIELDS = new Set([
  "id", "base44_id", "base44_synced_at", "local_quote_id", "_rev",
  "updated_date", "updated_at", "last_saved_at", "last_updated_by"
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function contentFingerprint(record) {
  const content = Object.fromEntries(Object.entries(record || {}).filter(([key]) => !SYNC_FIELDS.has(key)));
  return createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}

function hasNotificationChange(previous, incoming) {
  return contentFingerprint(previous) !== contentFingerprint(incoming);
}

function notificationEventId(type, record) {
  const time = parseRecordTimestamp(record.updated_date || record.updated_at || record.last_saved_at);
  return JSON.stringify([type, record.base44_id || record.id,
    Number.isFinite(time) ? time : null, contentFingerprint(record)]);
}

module.exports = {hasNotificationChange, notificationEventId};
