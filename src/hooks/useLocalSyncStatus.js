import { useCallback, useRef, useState } from "react";

// Human-readable labels for the webhook receiver's "reason" field, shared by the inline
// slim progress bar (Layout) and the deeper diagnostic dialog (RefreshStatusDialog) so
// both surfaces describe a given outcome identically.
export const REFRESH_REASON_LABELS = {
  imported: "New data imported",
  checked: "Already up to date",
  throttled: "Already up to date",
  invalid_signature: "Rejected: invalid webhook signature",
  decrypt_failed: "Rejected: could not decrypt payload",
  error: "Import failed"
};

/**
 * Single source of truth for "is a manual refresh in flight / did it work". Triggers the
 * local webhook receiver's force-refresh + outbound flush (via the enquoteLocal.app
 * Electron bridge) and awaits its definitive result directly - the main process's
 * "app:refresh" handler is request/response (not fire-and-forget), so there's no need to
 * poll and guess whether a real Base44 delivery happened to land during the check.
 * Shared by the inline slim progress bar in Layout and the optional diagnostic
 * RefreshStatusDialog so there is exactly one implementation of this logic.
 */
export function useLocalSyncStatus() {
  const [phase, setPhase] = useState("idle"); // idle | running | success | error | unreachable
  const [lastAttempt, setLastAttempt] = useState(null);
  const [events, setEvents] = useState([]);
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
    setPhase("running");

    let result;
    try {
      result = await bridge.refresh();
    } catch (error) {
      result = { ok: false, unreachable: true, error: error?.message };
    }

    // A newer trigger() started while this one was in flight - let that one own the state.
    if (runId !== runIdRef.current) return true;

    // Best-effort: pull the diagnostic event log for the Details dialog. Never blocks or
    // changes the reported outcome if it fails.
    try {
      const eventsRes = await bridge.getRefreshEvents?.(0);
      if (runId === runIdRef.current && eventsRes?.ok && Array.isArray(eventsRes.events)) {
        setEvents(eventsRes.events.slice(-200));
      }
    } catch {
      // Diagnostic log is optional.
    }

    const finishedAt = new Date().toISOString();
    if (!result?.ok) {
      setLastAttempt({
        ok: false,
        reason: result?.reason || "error",
        error: result?.error,
        finishedAt
      });
      setPhase(result?.unreachable ? "unreachable" : "error");
      return true;
    }

    setLastAttempt({
      ok: true,
      reason: result.reason || "checked",
      finishedAt,
      storedQuoteCount: result.storedQuoteCount,
      storedProductCount: result.storedProductCount
    });
    setPhase("success");
    return true;
  }, [bridge]);

  return { phase, lastAttempt, events, trigger, hasBridge: !!bridge?.refresh };
}
