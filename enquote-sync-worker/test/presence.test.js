import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handlePresenceHeartbeat,
  handlePresenceList,
  handlePresenceRemove
} from "../src/presence.js";

const email = "teammate@example.com";
const sessionId = "desktop-session-123";
const env = {
  ALLOWED_EMAILS_LIST: email,
  OUTBOUND_TOKEN: "presence-test-token",
  DB: createPresenceDatabase()
};

function makeRequest(path, method = "GET", body) {
  return new Request(`https://enquote-sync.example.workers.dev${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.OUTBOUND_TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

function createPresenceDatabase() {
  const sessions = new Map();
  return {
    prepare(sql) {
      let parameters = [];
      return {
        bind(...values) {
          parameters = values;
          return this;
        },
        async run() {
          if (sql.includes("INSERT INTO presence_sessions")) {
            const [id, userEmail, name, signedInAt, lastSeenAt] = parameters;
            const previous = sessions.get(id);
            sessions.set(id, {
              session_id: id,
              email: userEmail,
              name,
              signed_in_at: previous?.signed_in_at || signedInAt,
              last_seen_at: lastSeenAt
            });
          } else if (sql.includes("DELETE FROM presence_sessions WHERE session_id")) {
            const [id, userEmail] = parameters;
            if (sessions.get(id)?.email === userEmail) sessions.delete(id);
          } else if (sql.includes("DELETE FROM presence_sessions WHERE last_seen_at")) {
            const [cutoff] = parameters;
            for (const [id, session] of sessions) {
              if (session.last_seen_at < cutoff) sessions.delete(id);
            }
          }
          return { success: true };
        },
        async all() {
          const [cutoff] = parameters;
          const byEmail = new Map();
          for (const session of sessions.values()) {
            if (session.last_seen_at < cutoff) continue;
            const previous = byEmail.get(session.email);
            byEmail.set(session.email, {
              email: session.email,
              name: session.name,
              signedInAt: previous
                ? [previous.signedInAt, session.signed_in_at].sort()[0]
                : session.signed_in_at,
              lastSeenAt: previous
                ? [previous.lastSeenAt, session.last_seen_at].sort().at(-1)
                : session.last_seen_at
            });
          }
          return { results: [...byEmail.values()] };
        }
      };
    }
  };
}

test("presence requires the outbound token and an allow-listed email", async () => {
  const unauthorized = await handlePresenceList(
    new Request("https://enquote-sync.example.workers.dev/api/presence"),
    env
  );
  assert.equal(unauthorized.status, 401);

  const disallowed = await handlePresenceHeartbeat(
    makeRequest("/api/presence/heartbeat", "POST", { email: "other@example.com", sessionId }),
    env
  );
  assert.equal(disallowed.status, 403);
});

test("heartbeat keeps an active user online and sign-out removes the desktop session", async () => {
  const heartbeat = await handlePresenceHeartbeat(
    makeRequest("/api/presence/heartbeat", "POST", { email, name: "Teammate", sessionId }),
    env
  );
  assert.equal(heartbeat.status, 200);

  const list = await handlePresenceList(makeRequest("/api/presence"), env);
  const sessions = (await list.json()).sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].email, email);
  assert.equal(sessions[0].name, "Teammate");
  assert.ok(sessions[0].signedInAt);
  assert.ok(sessions[0].lastSeenAt);

  const removed = await handlePresenceRemove(
    makeRequest("/api/presence/remove", "POST", { email, sessionId }),
    env
  );
  assert.equal(removed.status, 200);

  const emptyList = await handlePresenceList(makeRequest("/api/presence"), env);
  assert.deepEqual((await emptyList.json()).sessions, []);
});
