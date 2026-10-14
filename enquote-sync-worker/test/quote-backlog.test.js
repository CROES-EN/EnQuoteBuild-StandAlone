import test from "node:test";
import assert from "node:assert/strict";
import {createSupervisorD1} from "../test-helpers/d1Shim.js";
import {captureQuoteBacklog, handleQuoteBacklog} from "../src/quote-backlog.js";
import {buildQuoteBacklog, backlogDate} from "../../shared/quoteBacklog.js";
import {computeQuoteAlert} from "../../shared/quoteSLA.js";
import {signUserToken} from "../src/user-token.js";

function environment() {
  const DB = createSupervisorD1(["0015_quote_backlog.sql", {sql:
    "CREATE TABLE quotes (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT);"}]);
  const prepare = DB.prepare;
  DB.prepare = sql => {
    const statement = prepare(sql);
    statement.first = async () => (await statement.all()).results[0] || null;
    return statement;
  };
  return {DB, USER_TOKEN_SECRET:"test", OUTBOUND_TOKEN:"test"};
}
const quote = id => ({id, status:"approved", site_id:String(id), created_date:"2026-10-01T00:00:00Z",
  status_history:[{status:"approved",changed_at:"2026-10-01T00:00:00Z"}]});
async function put(env, record) {
  await env.DB.prepare("INSERT OR REPLACE INTO quotes VALUES (?, ?, ?)").bind(record.id, JSON.stringify(record), "2026-10-13T00:00:00Z").run();
}

test("shared daily backlog freezes yesterday's 40 quotes while today's status change yields 39", async () => {
  const env = environment();
  for (let index = 0; index < 40; index++) await put(env, quote(String(index)));
  const yesterday = await captureQuoteBacklog(env, Date.parse("2026-10-13T05:59:00Z"));
  assert.equal(yesterday.date, "2026-10-12");
  assert.equal(yesterday.count, 40);
  assert.deepEqual(yesterday.statusCounts, {approved:40});
  await put(env, {...quote("0"),status:"scheduled",status_history:[{status:"scheduled",changed_at:"2026-10-13T06:01:00Z"}]});
  const today = await captureQuoteBacklog(env, Date.parse("2026-10-13T06:02:00Z"));
  assert.equal(today.date, "2026-10-13");
  assert.equal(today.count, 39);
  const stored = (await env.DB.prepare("SELECT payload FROM quote_backlog_daily WHERE date = ?").bind("2026-10-12").first()).payload;
  assert.deepEqual(JSON.parse(stored), JSON.parse(JSON.stringify(yesterday)), "prior day's rows, counts and status breakdown never follow current edits");
  assert.equal((await env.DB.prepare("SELECT * FROM quote_backlog_daily").all()).results.length, 2);
  await captureQuoteBacklog(env, Date.parse("2026-10-13T06:00:00Z"));
  const latest = JSON.parse((await env.DB.prepare("SELECT payload FROM quote_backlog_daily WHERE date = ?").bind(today.date).first()).payload);
  assert.equal(latest.capturedAt, today.capturedAt, "late earlier captures cannot overwrite a newer observation");
});

test("Mountain calendar days handle summer and winter midnight and DST boundaries", () => {
  assert.equal(backlogDate(Date.parse("2026-10-13T05:59:59Z")), "2026-10-12");
  assert.equal(backlogDate(Date.parse("2026-10-13T06:00:00Z")), "2026-10-13");
  assert.equal(backlogDate(Date.parse("2026-12-13T06:59:59Z")), "2026-12-12");
  assert.equal(backlogDate(Date.parse("2026-12-13T07:00:00Z")), "2026-12-13");
  assert.equal(backlogDate(Date.parse("2026-11-01T08:30:00Z")), "2026-11-01");
});

test("a database read crossing Mountain midnight cannot write today's edits into yesterday", async () => {
  const env = environment();
  for (let index = 0; index < 40; index++) await put(env, quote(String(index)));
  await captureQuoteBacklog(env, Date.parse("2026-10-13T05:59:57Z"));
  const prepare = env.DB.prepare;
  let clock = Date.parse("2026-10-13T05:59:59Z");
  let crossed = false;
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith("SELECT payload, updated_at FROM quotes")) {
      const all = statement.all;
      statement.all = async () => {
        if (!crossed) {
          crossed = true;
          clock = Date.parse("2026-10-13T06:00:01Z");
          await put(env, {...quote("0"), status: "scheduled"});
        }
        return all();
      };
    }
    return statement;
  };
  const originalNow = Date.now;
  Date.now = () => clock;
  try {
    const snapshot = await captureQuoteBacklog(env);
    assert.equal(snapshot.date, "2026-10-13");
    assert.equal(snapshot.count, 39);
    const prior = await env.DB.prepare("SELECT payload FROM quote_backlog_daily WHERE date = ?").bind("2026-10-12").first();
    assert.equal(JSON.parse(prior.payload).count, 40);
  } finally {
    Date.now = originalNow;
  }
});

test("snapshot uses the existing alert definition; overdue hours are numeric, not labels", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const records = [quote("approved"), {...quote("yellow"),status:"draft_without_internal",
    status_history:[],created_date:"2026-10-10T10:00:00Z"},
  {...quote("excluded"),exclude_from_reporting:true}, {...quote("old"),is_current_version:false},
  {...quote("hold"),status:"on_hold"}, {...quote("reason"),status:"ho_rejected",ho_rejection_reason:"Declined"}];
  const result = buildQuoteBacklog(records, now);
  assert.equal(result.count, 2);
  assert.equal(Object.values(result.statusCounts).reduce((sum,value) => sum + value,0),result.count);
  assert.equal(computeQuoteAlert(records[0],now).overdueHours, 276);
  assert.equal(computeQuoteAlert(records[1],now).overdueHours, 0, "yellow warning is not overdue");
  assert.equal(result.rows.length,result.count);
});

test("backlog endpoint requires authenticated team identity", async () => {
  assert.equal((await handleQuoteBacklog(new Request("https://worker.invalid/api/quote-backlog?date=2026-10-12"),environment())).status,401);
});

test("authenticated backlog validates dates and returns missing history without fabricating it", async () => {
  const env = {...environment(), ALLOWED_EMAILS_LIST: "user@example.com"};
  const headers = {Authorization: "Bearer test", "X-EnQuote-User": await signUserToken("user@example.com", env.USER_TOKEN_SECRET)};
  for (const date of ["2026-02-30", "2026-13-01", "invalid"]) {
    const response = await handleQuoteBacklog(new Request(`https://example/api/quote-backlog?date=${date}`, {headers}), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_backlog_date");
  }
  const response = await handleQuoteBacklog(new Request("https://example/api/quote-backlog?date=2020-01-01", {headers}), env);
  assert.deepEqual(await response.json(), {ok: true, live: false, snapshot: null});
  await put(env, {...quote("live"), status_history: [{status: "approved", changed_at: new Date(Date.now() - 72 * 3600000).toISOString()}]});
  const today = await handleQuoteBacklog(new Request(`https://example/api/quote-backlog?date=${backlogDate()}`, {headers}), env);
  const result = await today.json();
  assert.equal(result.live, true);
  assert.equal(result.snapshot.date, backlogDate());
  assert.equal(result.snapshot.count, 1);
});
