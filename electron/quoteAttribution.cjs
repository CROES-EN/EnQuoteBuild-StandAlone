function requireVerifiedEmail(identity) {
  const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
  if (!email || email.endsWith("@example.invalid")) {
    throw new Error("Verified Cloudflare identity is unavailable. Sign in again before editing quotes.");
  }
  return email;
}

function applyVerifiedQuoteCreator(record, identity) {
  const email = requireVerifiedEmail(identity);
  const statusHistory = Array.isArray(record?.status_history) ? [...record.status_history] : [];
  if (statusHistory.length > 0) {
    statusHistory[statusHistory.length - 1] = {
      ...statusHistory[statusHistory.length - 1],
      changed_by: email
    };
  }
  return {
    ...record,
    created_by_email: email,
    owner_email: record?.owner_email || email,
    status_history: statusHistory
  };
}

function applyVerifiedQuoteUpdate(current, changes, identity) {
  const email = requireVerifiedEmail(identity);
  const attributedChanges = { ...changes, last_updated_by: email };
  if (Array.isArray(changes?.status_history)) {
    const currentHistory = Array.isArray(current?.status_history) ? current.status_history : [];
    attributedChanges.status_history = changes.status_history.map((entry, index) =>
      JSON.stringify(entry) !== JSON.stringify(currentHistory[index])
        ? { ...entry, changed_by: email }
        : entry
    );
  }
  return attributedChanges;
}

function parseRecordTimestamp(value) {
  if (typeof value !== "string") return NaN;
  // Base44 timestamps without an offset are UTC, not the desktop's local timezone.
  return Date.parse(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value) ? `${value}Z` : value);
}

function recordedUpdater(quote) {
  const usableEmail = value => {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    return email && !email.endsWith("@example.invalid") ? email : null;
  };
  const updater = usableEmail(quote?.last_updated_by);
  if (updater) return updater;
  const history = Array.isArray(quote?.status_history) ? quote.status_history : [];
  const last = history[history.length - 1];
  const updatedAt = parseRecordTimestamp(quote?.updated_date);
  const changedAt = parseRecordTimestamp(last?.changed_at);
  return Number.isFinite(updatedAt) && Number.isFinite(changedAt) && Math.abs(updatedAt - changedAt) <= 1000
    ? usableEmail(last?.changed_by)
    : null;
}

module.exports = { applyVerifiedQuoteCreator, applyVerifiedQuoteUpdate, requireVerifiedEmail, recordedUpdater, parseRecordTimestamp };
