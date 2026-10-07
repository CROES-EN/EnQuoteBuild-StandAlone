import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Minimal D1 shim over a real in-memory SQLite database, so tests exercise the Worker's actual SQL.
export function createSupervisorD1(migrations = ["0002_supervisor_records.sql"]) {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) {
    db.exec(typeof migration === "string" ? readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8") : migration.sql);
  }
  const wrap = (sql) => {
    let params = [];
    const statement = {
      bind(...values) { params = values; return statement; },
      async run() { return runSync(); },
      async all() { return allSync(); },
      runSync,
      allSync,
      isSelect: /^\s*select/i.test(sql)
    };
    function allSync() {
      return { results: db.prepare(sql).all(...params) };
    }
    function runSync() {
      const { changes } = db.prepare(sql).run(...params);
      return { success: true, meta: { changes } };
    }
    return statement;
  };
  return {
    prepare: wrap,
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => (s.isSelect ? s.allSync() : s.runSync()));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

export function createCollabD1() {
  return createSupervisorD1(["0005_collab.sql", "0008_chat_reactions.sql", "0009_custom_emojis.sql"]);
}

// 0006 alters presence_sessions, which lives in schema.sql rather than a migration.
const PRESENCE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS presence_sessions (
  session_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
  signed_in_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);`;

export function createAdminD1() {
  return createSupervisorD1(["0005_collab.sql", { sql: PRESENCE_TABLE_SQL }, "0006_admin_profiles.sql", "0008_chat_reactions.sql"]);
}
