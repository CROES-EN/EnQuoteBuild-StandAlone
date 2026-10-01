function requireVerifiedEmail(identity) {
  const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
  if (!email) {
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

module.exports = { applyVerifiedQuoteCreator, applyVerifiedQuoteUpdate, requireVerifiedEmail };
