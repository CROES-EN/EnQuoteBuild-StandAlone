import assert from "node:assert/strict";
import test from "node:test";
import {localAdapter} from "../src/api/adapters/localAdapter.js";

test("local quote bulk updates wrap flat quote fields in changes", async () => {
  let receivedUpdates;
  globalThis.window = {
    enquoteLocal: {
      quotes: {
        bulkUpdate: async (updates) => {
          receivedUpdates = updates;
          return {updated: updates.length};
        }
      }
    }
  };

  const updates = [
    {id: "quote-1", status: "scheduled", scheduled_date: "2026-10-08T16:00:00.000Z"},
    {id: "quote-2", changes: {status: "scheduled"}}
  ];

  try {
    const result = await localAdapter.bulkUpdateQuotes(updates);

    assert.deepEqual(receivedUpdates, [
      {
        id: "quote-1",
        changes: {status: "scheduled", scheduled_date: "2026-10-08T16:00:00.000Z"}
      },
      {id: "quote-2", changes: {status: "scheduled"}}
    ]);
    assert.deepEqual(result, {updated: 2});
  } finally {
    delete globalThis.window;
  }
});
