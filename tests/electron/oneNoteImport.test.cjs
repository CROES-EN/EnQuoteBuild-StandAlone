const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {createOneNoteImport} = require("../../electron/oneNoteImport.cjs");

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-onenote-test-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const source = path.join(root, "Section.one");
  await fs.writeFile(source, "fixture");
  const records = [{id: "workbook", kind: "workbook", title: "SOP Library"}];
  const saved = [];
  let uploads = 0;
  let outputDirectory;
  const sops = {
    list: () => records,
    async save(record) {
      saved.push(record);
      const index = records.findIndex((item) => item.id === record.id);
      if (index < 0) records.push(record);
      else records[index] = record;
      return {ok: true, record};
    },
    async uploadFile({name, type}) {
      uploads++;
      return {ok: true, file: {fileId: "a".repeat(64), name, type, size: 10}};
    }
  };
  const progress = [];
  const service = createOneNoteImport({
    logger: {warn() {}},
    platform: "win32", chooseFile: async () => source, sops,
    onProgress: (event) => progress.push(event),
    exportImpl: async (_source, directory) => {
      outputDirectory = directory;
      const manifest = overrides.manifest || {
        title: "Imported Section",
        pages: [
          {title: "Admin", level: 1, html: "<p>Formatted <b>content</b></p>", pdf: "page-0.pdf", warnings: ["PDF preserves images"]},
          {title: "SLA", level: 2, html: "<p>SLA text</p>", pdf: "page-1.pdf"},
          {title: "Nested", level: 3, html: "<table><tr><td>Table</td></tr></table>", pdf: "page-2.pdf"},
          {title: "Other", level: 1, html: "", pdf: "page-3.pdf"}
        ]
      };
      for (const [index] of manifest.pages.entries()) await fs.writeFile(path.join(directory, `page-${index}.pdf`), "%PDF-1.4\nfixture");
      await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    },
    ...overrides.options
  });
  return {service, records, saved, sops, progress, root, uploads: () => uploads, directory: () => outputDirectory};
}

test("imports all pages with PDFs, editable content, ordering and multi-level hierarchy", async (t) => {
  const f = await fixture(t);
  const [preview] = (await f.service.prepare()).previews;
  assert.deepEqual(preview.pages.map((page) => page.depth), [0, 1, 2, 0]);
  assert.ok(preview.warnings.some((warning) => warning.includes("shared")));
  assert.equal(preview.pages.some((page) => page.pdfPath), false);
  const result = await f.service.importSection({sessionId: preview.sessionId});
  assert.equal(result.imported, 4);
  const section = f.records.find((record) => record.id === result.sectionId);
  assert.equal(section.workbook_id, "workbook-sop-library");
  const pages = f.records.filter((record) => record.section_id === section.id);
  assert.equal(pages[1].parent_id, pages[0].id);
  assert.equal(pages[2].parent_id, pages[1].id);
  assert.equal(pages[3].parent_id, null);
  assert.equal(pages[3].order, 1);
  assert.ok(pages[0].content_html.includes("<b>content</b>"));
  assert.equal(pages[2].files[0].type, "application/pdf");
  assert.equal(f.uploads(), 4);
  assert.equal(f.progress.at(-1).completed, 4);
  await assert.rejects(fs.stat(f.directory()), {code: "ENOENT"});
});

test("failed page saves retry the same IDs and reuse already uploaded PDFs", async (t) => {
  const f = await fixture(t);
  const [preview] = (await f.service.prepare()).previews;
  const originalSave = f.sops.save;
  f.sops.save = async (record) => {
    if (record.title === "SLA") throw new Error("Offline");
    return originalSave(record);
  };
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId}), /Imported 1 of 4 pages.*Offline.*without duplicating/);
  assert.equal(f.uploads(), 2);
  f.sops.save = originalSave;
  const result = await f.service.importSection({sessionId: preview.sessionId});
  assert.equal(result.imported, 4);
  assert.equal(f.uploads(), 4);
  assert.equal(new Set(f.records.map((record) => record.id)).size, f.records.length);
  assert.equal(f.saved.filter((record) => record.kind === "section").length, 1);
});

test("cancel clears temporary exports without deleting partially imported SOP records", async (t) => {
  const f = await fixture(t);
  const [preview] = (await f.service.prepare()).previews;
  f.sops.uploadFile = async () => { throw new Error("Upload failed"); };
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId}), /Upload failed/);
  await f.service.cancel(preview.sessionId);
  await assert.rejects(fs.stat(f.directory()), {code: "ENOENT"});
  assert.equal(f.records.filter((record) => record.kind === "section").length, 1);
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId}), /expired/);
});

test("validation rejects malformed nesting, unsafe file paths and unavailable sections", async (t) => {
  for (const page of [
    {title: "Invalid level", html: "", level: 3, pdf: "page-0.pdf"},
    {title: "Invalid path", html: "", level: 1, pdf: "..\\other.pdf"},
    {title: "Too long", html: "x".repeat(900001), level: 1, pdf: "page-0.pdf"}
  ]) {
    const f = await fixture(t, {manifest: {title: "Invalid", pages: [page]}});
    await assert.rejects(f.service.prepare());
    await assert.rejects(fs.stat(f.directory()), {code: "ENOENT"});
  }
  const f = await fixture(t);
  const [preview] = (await f.service.prepare()).previews;
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId, sectionId: "missing"}), /available destination section/);
  assert.equal(f.saved.length, 0);
  await f.service.cancel(preview.sessionId);
});

test("cancelled file picker and unsupported platforms do not export anything", async (t) => {
  const f = await fixture(t, {options: {chooseFile: async () => null}});
  assert.equal((await f.service.prepare()).cancelled, true);
  const other = await fixture(t, {options: {platform: "darwin"}});
  await assert.rejects(other.service.prepare(), /Windows OneNote/);
});

test("previews cannot be imported after switching accounts", async (t) => {
  let email = "first@example.invalid";
  const f = await fixture(t, {options: {getEmail: () => email}});
  const [preview] = (await f.service.prepare()).previews;
  email = "second@example.invalid";
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId}), /account changed/);
  assert.equal(f.saved.length, 0);
  await f.service.cancel(preview.sessionId);
});

test("existing-section imports create one named parent and preserve nested page hierarchy", async (t) => {
  const f = await fixture(t);
  f.records.push({id: "existing", kind: "section", title: "Marketplace", workbook_id: "workbook"});
  f.records.push({id: "untouched", title: "Existing page", section_id: "existing", order: 5, content_html: "Original"});
  const [preview] = (await f.service.prepare()).previews;
  const result = await f.service.importSection({sessionId: preview.sessionId, sectionId: "existing"});
  assert.equal(result.sectionId, "existing");
  const parent = f.records.find((record) => record.id === result.parentPageId);
  assert.equal(parent.title, "Imported Section");
  assert.equal(parent.parent_id, null);
  assert.equal(parent.order, 6);
  const pages = preview.pages.map((page) => f.records.find((record) => record.id === page.id));
  assert.equal(pages[0].parent_id, parent.id);
  assert.equal(pages[1].parent_id, pages[0].id);
  assert.equal(pages[2].parent_id, pages[1].id);
  assert.equal(pages[3].parent_id, parent.id);
  assert.ok(pages.every((page) => page.section_id === "existing" && page.category === "Marketplace"));
  assert.equal(f.saved.some((record) => record.kind === "section"), false);
  assert.equal(f.records.find((record) => record.id === "untouched").content_html, "Original");
});

test("existing-section partial retries reuse the parent and require the same destination", async (t) => {
  const f = await fixture(t);
  f.records.push({id: "existing", kind: "section", title: "Marketplace", workbook_id: "workbook"});
  f.records.push({id: "other-section", kind: "section", title: "Other", workbook_id: "workbook"});
  const [preview] = (await f.service.prepare()).previews;
  const save = f.sops.save;
  f.sops.save = async (record) => {
    if (record.title === "SLA") throw new Error("Offline");
    return save(record);
  };
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId, sectionId: "existing"}), /Imported 1 of 4/);
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId, sectionId: "other-section"}), /same section/);
  await assert.rejects(f.service.importSection({sessionId: preview.sessionId}), /same section/);
  f.sops.save = save;
  const result = await f.service.importSection({sessionId: preview.sessionId, sectionId: "existing"});
  assert.equal(f.saved.filter((record) => record.id === result.parentPageId).length, 1);
  assert.equal(result.imported, 4);
  assert.equal(f.uploads(), 4);
});

test("legacy sections in any workbook are valid destinations; unavailable ones are rejected", async (t) => {
  const f = await fixture(t);
  f.records.push({id: "elsewhere", kind: "section", title: "Elsewhere", workbook_id: "another"});
  const [preview] = (await f.service.prepare()).previews;
  f.records.push({id: "gone", kind: "section", title: "Gone", deleted: true});
  for (const sectionId of ["missing", "gone"]) {
    await assert.rejects(f.service.importSection({sessionId: preview.sessionId, sectionId}), /available destination section/);
  }
  assert.equal(f.saved.length, 0);
  const result = await f.service.importSection({sessionId: preview.sessionId, sectionId: "elsewhere"});
  assert.equal(result.sectionId, "elsewhere");
  assert.equal(f.records.find((record) => record.id === result.parentPageId).section_id, "elsewhere");
});

test("multiple .one files become separate parent pages in one destination section, in order", async (t) => {
  let exported = 0;
  const f = await fixture(t);
  const exportImpl = async (source, directory) => {
    exported++;
    await fs.writeFile(path.join(directory, "page-0.pdf"), "%PDF-1.4\nfixture");
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({title: path.basename(source, ".one"), pages: [{title: `${path.basename(source, ".one")} page`, level: 1, html: "<p>x</p>", pdf: "page-0.pdf"}]}));
  };
  await fs.writeFile(path.join(f.root, "First.one"), "fixture");
  await fs.writeFile(path.join(f.root, "Second.one"), "fixture");
  const service = createOneNoteImport({platform: "win32", sops: f.sops, exportImpl, logger: {warn() {}}, chooseFile: async () => [path.join(f.root, "First.one"), path.join(f.root, "Second.one"), path.join(f.root, "First.one")]});
  f.records.push({id: "marketplace", kind: "section", title: "O&M Marketplace", workbook_id: "legacy"});
  const {previews} = await service.prepare();
  assert.equal(exported, 2, "Duplicate selections are read once");
  assert.deepEqual(previews.map((preview) => preview.title), ["First", "Second"]);
  assert.notEqual(previews[0].sessionId, previews[1].sessionId);
  const first = await service.importSection({sessionId: previews[0].sessionId, sectionId: "marketplace"});
  const second = await service.importSection({sessionId: previews[1].sessionId, sectionId: "marketplace"});
  const parents = [first, second].map((result) => f.records.find((record) => record.id === result.parentPageId));
  assert.deepEqual(parents.map((parent) => parent.title), ["First", "Second"]);
  assert.ok(parents[1].order > parents[0].order);
  assert.equal(f.records.find((record) => record.title === "Second page").parent_id, parents[1].id);
});

test("a failing file cancels the whole batch and removes every temporary export", async (t) => {
  const f = await fixture(t);
  const directories = [];
  const sources = ["Good.one", "Bad.one"].map((name) => path.join(f.root, name));
  for (const source of sources) await fs.writeFile(source, "fixture");
  const service = createOneNoteImport({
    platform: "win32", sops: f.sops, logger: {warn() {}}, chooseFile: async () => sources,
    exportImpl: async (source, directory) => {
      directories.push(directory);
      if (source.endsWith("Bad.one")) throw new Error("OneNote could not open it");
      await fs.writeFile(path.join(directory, "page-0.pdf"), "%PDF-1.4\nfixture");
      await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({title: "Good", pages: [{title: "Good page", level: 1, html: "", pdf: "page-0.pdf"}]}));
    }
  });
  await assert.rejects(service.prepare(), /Bad\.one: OneNote could not open it/);
  for (const directory of directories) await assert.rejects(fs.stat(directory), {code: "ENOENT"});
  assert.equal(f.saved.length, 0);
});

test("multi-select rejects non-.one files and more than 20 files before exporting", async (t) => {
  const f = await fixture(t);
  let exported = 0;
  const make = (chosen) => createOneNoteImport({platform: "win32", sops: f.sops, logger: {warn() {}}, chooseFile: async () => chosen, exportImpl: async () => { exported++; }});
  await assert.rejects(make([path.join(f.root, "Section.one"), path.join(f.root, "notes.txt")]).prepare(), /notes\.txt.*not a OneNote section/);
  await assert.rejects(make(Array.from({length: 21}, (_, index) => path.join(f.root, `S${index}.one`))).prepare(), /up to 20/);
  assert.equal((await make([]).prepare()).cancelled, true);
  assert.equal(exported, 0);
});