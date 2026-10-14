import {buildQuoteBacklog, backlogDate} from "../../shared/quoteBacklog.js";
import {getSnapshot} from "./repository.js";
import {authenticateUser} from "./user-token.js";
import {json} from "./util.js";

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
    const snapshot = await captureQuoteBacklog(env);
    if (snapshot.date === date) return json({ok: true, snapshot, live: true});
  }
  const row = await env.DB.prepare("SELECT payload FROM quote_backlog_daily WHERE date = ?").bind(date).first();
  return json({ok: true, snapshot: row ? JSON.parse(row.payload) : null, live: false});
}
