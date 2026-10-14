import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {
  buildMailtoUrl, buildRmaEmail, fillRmaTemplate, findManufacturerConfig, MAILTO_MAX_LENGTH,
  parseEmailList, rmaEmailText, validateRmaWizardSettings
} from "../src/features/rma/manufacturerSubmission.js";

const require = createRequire(import.meta.url);
async function bundle(entry) {
  const result = await build({entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs",
    packages: "external", alias: {"@": path.resolve("src")}});
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

// Mirrors electron/repository.cjs: updates MERGE changes into the stored record.
function mergingBridge(initial = []) {
  const records = new Map(initial.map(record => [record.id, {...record}]));
  return {
    records,
    list: async () => [...records.values()].map(record => ({...record})),
    create: async (_name, record) => {
      if (records.has(record.id)) throw new Error("This case already has a saved Auto-Drafter quote.");
      records.set(record.id, {...record});
      return record;
    },
    update: async (_name, id, changes) => {
      const next = {...records.get(id), ...changes, id};
      records.set(id, next);
      return next;
    },
    delete: async (_name, id) => {records.delete(id);}
  };
}

const store = await bundle(path.join("src", "features", "autoDrafter", "autoDrafterDraftsStore.js"));

test("removing a case keeps it out of Auto-Drafter, survives Clear Generated Drafts, and restores cleanly", async () => {
  const bridge = mergingBridge([
    {id: "100", caseNumber: "100", siteId: "S1", draft: {items: [{name: "Part"}]}, parseWarnings: ["w"]},
    {id: "200", caseNumber: "200", siteId: "S2", draft: {items: []}}
  ]);
  globalThis.window = {enquoteLocal: {collections: bridge}};
  try {
    await assert.rejects(store.removeCaseFromAutoDrafter("100", {reason: "nope"}), /Choose why/);
    await assert.rejects(store.removeCaseFromAutoDrafter("100", {reason: "other", note: "  "}), /Add a note/);
    await store.removeCaseFromAutoDrafter("100", {reason: "panel_rma_filed", note: " RMA emailed ", removedBy: "a@b.com"});
    await store.removeCaseFromAutoDrafter("300", {reason: "quote_not_needed", siteId: "S3"});
    assert.equal(bridge.records.get("100").removedFromAutoDrafter.note, "RMA emailed");
    assert.equal(bridge.records.get("100").removedFromAutoDrafter.removedBy, "a@b.com");
    assert.equal(bridge.records.get("300").draft, undefined);
    assert.equal(store.removalReasonLabel("panel_rma_filed"), "Panel RMA filed");

    await store.clearAllGeneratedDrafts();
    assert.deepEqual([...bridge.records.keys()].sort(), ["100", "300"]);
    assert.equal(bridge.records.get("100").draft, null, "cleared draft must not survive the merging update");
    assert.equal(bridge.records.get("100").parseWarnings, null);
    assert.ok(bridge.records.get("100").removedFromAutoDrafter);

    assert.equal(await store.restoreCaseToAutoDrafter("300"), null);
    assert.equal(bridge.records.has("300"), false);
    bridge.records.get("100").draft = {items: []};
    const restored = await store.restoreCaseToAutoDrafter("100");
    assert.equal(restored.removedFromAutoDrafter, null);
    assert.equal(bridge.records.get("100").removedFromAutoDrafter, null, "restore must clear the stored removal");
  } finally {
    delete globalThis.window;
  }
});

test("manufacturer RMA settings resolve, validate and build a submission email", () => {
  const manufacturers = [
    {id: "1", name: "REC Solar", rma_submission_method: "email", rma_email_to: "claims@rec.example; warranty@rec.example",
      rma_email_cc: "ops@enphase.example", rma_email_subject: "Claim {case} / {model}", rma_email_intro: "Hi {manufacturer} team,",
      rma_instructions: "Attach flash test."},
    {id: "2", name: "Qcells"}
  ];
  const config = findManufacturerConfig(manufacturers, "rec solar");
  assert.equal(config.method, "email");
  assert.deepEqual(config.emailTo, ["claims@rec.example", "warranty@rec.example"]);
  assert.equal(findManufacturerConfig(manufacturers, "REC").name, "REC Solar");
  assert.equal(findManufacturerConfig(manufacturers, "Qcells").configured, false);
  assert.equal(findManufacturerConfig(manufacturers, "SunPower"), null);
  assert.equal(findManufacturerConfig(manufacturers, ""), null);

  assert.deepEqual(parseEmailList("a@b.com, c@d.com;e@f.com"), ["a@b.com", "c@d.com", "e@f.com"]);
  assert.deepEqual(validateRmaWizardSettings({name: "X", rma_submission_method: "email"}), ["Add at least one To email address for email submissions."]);
  assert.match(validateRmaWizardSettings({name: "X", rma_form_url: "http://insecure.example"}).join(), /https/);
  assert.match(validateRmaWizardSettings({name: "X", rma_submission_method: "both", rma_email_to: "not-an-email"}).join(), /Invalid email/);
  assert.deepEqual(validateRmaWizardSettings({name: "X", rma_submission_method: "form", rma_form_url: "https://ok.example/claim"}), []);

  const data = {case_id: "12345", site_id: "999", panel_manufacturer: "REC Solar", panel_model: "", panel_quantity: 3, serial_numbers: "A1, A2"};
  assert.equal(fillRmaTemplate("{case}-{model}", data), "12345-[MODEL NEEDED]");
  const email = buildRmaEmail(config, data, {diagnosis: "Hot spot found"});
  assert.equal(email.subject, "Claim 12345 / [MODEL NEEDED]");
  assert.match(email.body, /^Hi REC Solar team,/);
  assert.match(email.body, /Serial numbers: A1, A2/);
  assert.match(email.body, /Problem \/ diagnosis and test results: Hot spot found/);
  assert.match(rmaEmailText(email), /^To: claims@rec\.example; warranty@rec\.example\nCc: ops@enphase\.example\nSubject: Claim 12345/);

  const short = buildMailtoUrl(email);
  assert.equal(short.truncated, false);
  assert.ok(short.url.startsWith("mailto:claims%40rec.example,warranty%40rec.example?cc=ops%40enphase.example&subject=Claim%2012345"));
  const long = buildMailtoUrl({...email, body: "Hot spot 🔥 ".repeat(400)});
  assert.equal(long.truncated, true);
  assert.ok(long.url.length <= MAILTO_MAX_LENGTH);
  assert.match(decodeURIComponent(long.url), /Email shortened/);
});
