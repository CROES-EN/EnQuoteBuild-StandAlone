import {useCallback, useRef, useState} from "react";

// Human-readable labels for refresh outcomes, shared by the inline status and details
// dialog so both surfaces describe a given result identically.
export const REFRESH_REASON_LABELS = {
  imported: "New data imported",
  synced: "Outgoing quotes sent; no incoming changes",
  checked: "Already up to date",
  throttled: "Already up to date",
  invalid_signature: "Rejected: invalid webhook signature",
  decrypt_failed: "Rejected: could not decrypt payload",
  error: "Import failed"
};

/**
 * Single source of truth for "is a manual refresh in flight / did it work". Triggers the
 * Cloudflare shared-data refresh + outbound flush (via the enquoteLocal.app Electron
 * bridge) and awaits its definitive result directly - the main process's
 * "app:refresh" handler is request/response (not fire-and-forget), so there's no need to
 * poll and guess whether a real Base44 delivery happened to land during the check.
 * Shared by the inline slim progress bar in Layout and the optional diagnostic
 * RefreshStatusDialog so there is exactly one implementation of this logic.
 */
export function useLocalSyncStatus() {
  const [phase, setPhase] = useState("idle"); // idle | running | success | error | unreachable
  const [lastAttempt, setLastAttempt] = useState(null);
  const [events, setEvents] = useState([]);
  const [progress, setProgress] = useState(null);
  const [outboundStatus, setOutboundStatus] = useState(null);
  const runIdRef = useRef(0);

  const bridge = typeof window !== "undefined" ? window.enquoteLocal?.app : null;

  // Kicks off a refresh check and awaits its definitive outcome. Returns false immediately
  // (without changing phase to "running") when there's no Electron bridge at all, so
  // callers can fall back to a synchronous soft-refresh instead of awaiting something that
  // will never resolve meaningfully.
  const trigger = useCallback(async () => {
    if (!bridge?.refresh) return false;

    const runId = ++runIdRef.current;
    setEvents([]);
    setLastAttempt(null);
    setProgress({ stage: "outbound" });
    setPhase("running");

    let result;
    let unsubscribeProgress;
    try {
      unsubscribeProgress = bridge.onRefreshProgress?.((nextProgress) => {
        if (runId === runIdRef.current) setProgress(nextProgress);
      });
      result = await bridge.refresh();
    } catch (error) {
      result = { ok: false, error: error?.message };
    } finally {
      unsubscribeProgress?.();
    }

    // A newer trigger() started while this one was in flight - let that one own the state.
    if (runId !== runIdRef.current) return true;

    // REMOVED: this used to pull the diagnostic event log from the retired
    // webhook-receiver.cjs ("app:refresh-events", localhost:3001). That IPC channel was
    // removed from main.cjs as dead code - this was its last remaining caller, which
    // already failed safely (optional-chaining + try/catch) but logged a noisy console
    // error every refresh. The Details dialog's event log will simply show no
    // historical entries going forward - the actual refresh outcome (phase/lastAttempt
    // below) is completely unaffected.

    const finishedAt = new Date().toISOString();
    if (!result?.ok) {
      if (result?.outbound) {
        setOutboundStatus({
          pending: result.outbound.pending ?? 0,
          synced: 0,
          total: result.outbound.total ?? 0,
          configured: result.outbound.configured ?? false
        });
      }
      setLastAttempt({
        ok: false,
        reason: result?.reason || "error",
        error: result?.error,
        finishedAt,
        outbound: result?.outbound
      });
      setProgress({ stage: "error", outbound: result?.outbound, error: result?.error });
      setPhase(result?.unreachable ? "unreachable" : "error");
      return true;
    }

    const outbound = result.outbound || null;
    if (outbound) {
      setOutboundStatus({
        pending: outbound.pending ?? result.outboundPending ?? 0,
        synced: result.outboundSync ?? 0,
        total: outbound.total ?? 0,
        configured: outbound.configured ?? false
      });
    }
    setLastAttempt({
      ok: true,
      reason: result.reason || "checked",
      finishedAt,
      storedQuoteCount: result.storedQuoteCount,
      storedProductCount: result.storedProductCount,
      quoteSnapshotCount: result.quoteSnapshotCount,
      quoteAddedCount: result.quoteAddedCount,
      quoteUpdatedCount: result.quoteUpdatedCount,
      outbound
    });
    setProgress({
      stage: "complete",
      inbound: {
        quoteSnapshotCount: result.quoteSnapshotCount,
        quoteAddedCount: result.quoteAddedCount,
        quoteUpdatedCount: result.quoteUpdatedCount
      },
      outbound
    });
    setPhase("success");
    return true;
  }, [bridge]);

  // Outbound sync health (Base44-bound direction) - separate from the inbound
// phase/lastAttempt/trigger above, which only covers PULLING data down. Surfaces
// real, actionable sync problems (e.g. a missing .env/API key, or quotes stuck
// waiting to push) directly in the UI instead of requiring a manual diagnostic.
// Never throws - returns null on any failure so it can never break the existing
// refresh flow above.
const fetchOutboundStatus = useCallback(async () => {
  try {
    const syncBridge = typeof window !== "undefined" ? window.enquoteLocal?.sync : null;
    if (!syncBridge?.outboundStatus) {
      setOutboundStatus(null);
      return null;
    }
    const result = await syncBridge.outboundStatus();
    if (!result) {
      setOutboundStatus(null);
      return null;
    }
    const normalized = {
      pending: result.pending ?? 0,
      synced: result.synced ?? 0,
      total: result.total ?? 0,
      configured: result.configured ?? false
    };
    setOutboundStatus(normalized);
    return normalized;
  } catch {
    setOutboundStatus(null);
    return null;
  }
}, []);

return { phase, lastAttempt, events, progress, trigger, hasBridge: !!bridge?.refresh, outboundStatus, fetchOutboundStatus };
}
