export function parseNotificationTimestamp(value) {
  if (typeof value !== "string") return NaN;
  // Base44 omits the timezone suffix from UTC timestamps.
  return Date.parse(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value) ? `${value}Z` : value);
}
