/**
 * Shared "intelligence" logic for the diagnostic report feature -- used by BOTH the
 * sender (analyzes before submitting, so the report arrives pre-diagnosed) and the
 * receiver (re-analyzes on arrival, so YOUR own review doesn't depend on trusting the
 * sender's app version to have the same logic baked in).
 *
 * Every check here reuses a REAL, confirmed pattern from tonight's actual
 * investigation -- not a guess at what might matter:
 *   - The 404-at-retry-cap bug (confirmed, found, and fixed live tonight).
 *   - The missing .env/API key check (the leading theory for Shane's issue).
 *   - The missing remote-sync-config.json check (Denice/Heather's setup issue).
 *
 * Functionally tested in a sandbox before being written here, across the exact real
 * scenario found tonight (2 stuck 404s + 1 healthy retry), a DIFFERENT stuck-error
 * type (correctly flagged as needing investigation, not auto-resolved), and the
 * Shane-suspected missing-config scenario -- all produced the correct result.
 */

const MAX_ATTEMPTS = 5;

function analyzeOutboundQueue(outboundQueue) {
  const pending = (outboundQueue || []).filter((e) => e.status === "pending");
  const stuckAtCap = pending.filter((e) => (e.attempts || 0) >= MAX_ATTEMPTS);
  const stuck404 = stuckAtCap.filter((e) => e.last_error && e.last_error.includes("HTTP 404"));
  const stuckOther = stuckAtCap.filter((e) => !e.last_error || !e.last_error.includes("HTTP 404"));
  const stillRetrying = pending.filter((e) => (e.attempts || 0) < MAX_ATTEMPTS);

  const findings = [];
  if (stuck404.length > 0) {
    findings.push({
      severity: "known_issue",
      summary: `${stuck404.length} quote(s) permanently stuck (HTTP 404, hit retry cap) - these were likely deleted/moved to Boneyard on Base44's side. Safe to reset with reset-stuck-404-quotes.ps1.`,
      affectedQuotes: stuck404.map((e) => e.quote_number)
    });
  }
  if (stuckOther.length > 0) {
    findings.push({
      severity: "needs_investigation",
      summary: `${stuckOther.length} quote(s) permanently stuck with a DIFFERENT error type - this is NOT the known 404 pattern and needs manual investigation.`,
      affectedQuotes: stuckOther.map((e) => ({ quote_number: e.quote_number, error: e.last_error }))
    });
  }
  if (stillRetrying.length > 0) {
    findings.push({
      severity: "info",
      summary: `${stillRetrying.length} quote(s) still within their normal retry window - no action needed yet.`,
      affectedQuotes: stillRetrying.map((e) => e.quote_number)
    });
  }
  return findings;
}

function analyzeConfig({ hasEnvKey, hasRemoteSyncConfig, isHost }) {
  const findings = [];
  if (!hasEnvKey && !isHost) {
    findings.push({
      severity: "critical",
      summary: "Outbound sync is NOT configured (.env/API key missing) - quotes created on this machine will never reach Base44."
    });
  }
  if (!isHost && !hasRemoteSyncConfig) {
    findings.push({
      severity: "warning",
      summary: "No remote-sync-config.json found - this machine cannot pull data from the host yet."
    });
  }
  return findings;
}

/** Combines all findings into one flat list, sorted so the most severe issues appear first. */
function analyzeAll({ outboundQueue, hasEnvKey, hasRemoteSyncConfig, isHost }) {
  const severityOrder = { critical: 0, known_issue: 1, needs_investigation: 2, warning: 3, info: 4 };
  const findings = [
    ...analyzeConfig({ hasEnvKey, hasRemoteSyncConfig, isHost }),
    ...analyzeOutboundQueue(outboundQueue)
  ];
  findings.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));
  return findings;
}

module.exports = { analyzeOutboundQueue, analyzeConfig, analyzeAll, MAX_ATTEMPTS };
