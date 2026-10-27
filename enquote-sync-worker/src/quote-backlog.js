import {buildQuoteBacklog, backlogDate} from "../../shared/quoteBacklog.js";
import {getSnapshot, getSnapshotMeta} from "./repository.js";
import {authenticateUser} from "./user-token.js";
import {json} from "./util.js";

// The cron refreshes today's backlog every 5 minutes. Dashboards poll every minute; rebuilding
// the backlog reads every quote, so viewers reuse a recent capture unless a quote changed since.
export const LIVE_BACKLOG_REUSE_MS = 5 * 60 * 1000;

export async function captureQuoteBacklog(env, nowMs) {
  const startedAt = nowMs ?? Date.now();
  const quotes = await getSnapshot(env.DB);
  if (nowMs === undefined && backlogDate(startedAt) !== backlogDate()) {
    return captureQuoteBacklog(env, Date.now());
  }
  const snapshot = buildQuoteBacklog(quotes, startedAt);
  await env.DB.prepare(`INSERT INTO quote_backlog_daily (date, captured_at, payload) VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET captured_at = excluded.captured_at, payload = excluded.payload
    WHERE quote_backlog_daily.captured_at < excluded.captured_at`)
    .bind(snapshot.date, snapshot.capturedAt, JSON.stringify(snapshot)).run();
  return snapshot;
}

export async function handleQuoteBacklog(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    return json({ok: false, error: "invalid_backlog_date"}, 400);
  }
  const today = backlogDate();
  if (date === today) {
    const recent = await recentLiveBacklog(env, date);
    if (recent) return json({ok: true, snapshot: recent, live: true});
    const snapshot = await captureQuoteBacklog(env);
    if (snapshot.date === date) return json({ok: true, snapshot, live: true});
  }
  const row = await env.DB.prepare("SELECT payload FROM quote_backlog_daily WHERE date = ?").bind(date).first();
  return json({ok: true, snapshot: row ? JSON.parse(row.payload) : null, live: false});
}

async function recentLiveBacklog(env, date, nowMs = Date.now()) {
  const row = await env.DB.prepare("SELECT captured_at, payload FROM quote_backlog_daily WHERE date = ?").bind(date).first();
  const capturedMs = Date.parse(row?.captured_at || "");
  if (!Number.isFinite(capturedMs) || nowMs - capturedMs < 0 || nowMs - capturedMs >= LIVE_BACKLOG_REUSE_MS) return null;
  const lastSavedMs = Date.parse(await getSnapshotMeta(env.DB) || "");
  if (Number.isFinite(lastSavedMs) && lastSavedMs >= capturedMs) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}
