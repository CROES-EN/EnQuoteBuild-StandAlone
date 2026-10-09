const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {mapSource, createRefundCsvSource} = require("./refundCsvSource.cjs");
const HEADER = "Response ID,Submitted at,Responder name,Responder email,When should the Enphase Care plan be canceled?,Is a refund also being requested?,Refund amount requested,Were any Enphase Care services completed?,Is the customer escalated?,Site ID,Subscription ID,Customer name,Customer email address,Case number,Primary reason for the cancel and/or refund request,Specify the cancellation/refund reason,Detailed explanation of the refund request";
const ROW = "1,2026-10-09T16:49:15.1934828Z,Requester,requester@example.com,Immediately,Full refund,1200,No,Yes,1111,1111,Customer,customer@example.com,123123,Long wait for appointments,,Explanation";
test("source maps actual report headers and rejects missing IDs, invalid amounts and malformed rows", () => {
  const [record] = mapSource(`${HEADER}\r\n${ROW}`);
  assert.equal(record.refundAmountRequested, 1200);
  assert.equal(record.servicesCompleted, false);
  assert.equal(record.customerEscalated, true);
  assert.equal(record.refundType, "Full Refund");
  assert.equal(record.status, "Submitted");
  assert.equal(record.caseNumber, "123123");
  assert.equal(record.submittedAt, "2026-10-09T16:49:15.193Z");
  assert.match(record.externalResponseId, /^csv-/);
  assert.throws(() => mapSource(`${HEADER}\n${ROW}\n${ROW}`), /duplicate/);
  assert.throws(() => mapSource(`${HEADER}\n${ROW.replace(",1200,", ",bad,")}`), /invalid refund amount/);
  assert.throws(() => mapSource(`${HEADER}\n1,2`), /number of columns/);
  assert.throws(() => mapSource("Other,Headers\n1,2"), /missing/);
});
test("repeated imports preserve source bytes and EnQuote workflow fields while updating source answers", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refund-source-test-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  const file = path.join(dir, "source.csv");
  const content = `${HEADER}\r\n${ROW}`;
  fs.writeFileSync(file, content);
  let records = [], posts = [];
  const service = createRefundCsvSource({
    storageDir: dir, defaultPath: file, getEmail: () => "requester@example.com",
    client: {
      get: async () => ({requests: records}),
      post: async (_route, body) => {
        posts.push(body);
        records.push(...body.imports.map((record) => ({...record, lastUpdatedAt: "version"})));
        for (const update of body.updates) Object.assign(records[0], update.changes);
        return {ok: true, imported: body.imports.length, updated: body.updates.length, conflicts: []};
      }
    }
  });
  assert.equal((await service.sync()).imported, 1);
  records[0].status = "Approved";
  records[0].storeTeamNotes = "Keep";
  assert.equal((await service.sync()).imported, 0);
  assert.equal(posts.length, 1);
  fs.writeFileSync(file, content.replace(",1200,", ",1300,"));
  assert.equal((await service.sync()).updated, 1);
  assert.deepEqual(posts[1].updates[0].changes, {refundAmountRequested: 1300});
  assert.equal(records[0].status, "Approved");
  assert.equal(records[0].storeTeamNotes, "Keep");
  assert.equal(fs.readFileSync(file, "utf8"), content.replace(",1200,", ",1300,"));
});
