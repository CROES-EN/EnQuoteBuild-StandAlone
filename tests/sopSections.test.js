import test from "node:test";
import assert from "node:assert/strict";
import {
  flattenPages,
  createSectionRecord,
  createWorkbookRecord,
  DEFAULT_WORKBOOK_ID,
  isPageDoc,
  isParentPage,
  descendantPages,
  pageAncestors,
  movePageBranch,
  legacySectionId,
  normalizeSopNotebook,
  reorderWithinSection,
  sectionForPage
} from "../src/components/sop/sopSections.js";

test("legacy pages are grouped into deterministic category sections", () => {
  const {sections, pages, sectionNames} = normalizeSopNotebook([
    {id: "a", title: "Install", category: "Field Ops"},
    {id: "b", title: "Warranty", category: "General"},
    {id: "deleted", title: "Gone", deleted: true, category: "Field Ops"},
    null
  ]);

  assert.equal(legacySectionId("Field Ops"), "section-field-ops");
  assert.deepEqual(sections.map((section) => section.id), ["section-field-ops", "section-general"]);
  assert.equal(sectionNames["section-field-ops"], "Field Ops");
  assert.equal(sectionForPage(pages[0]), "section-field-ops");
  assert.equal(pages.length, 2);
});

test("section records are kept and hidden from page lists", () => {
  const {sections, pages} = normalizeSopNotebook([
    {id: "section-custom", kind: "section", title: "Custom", color: "#123456", order: 4},
    {id: "p1", title: "Page", section_id: "section-custom", order: 2}
  ]);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].color, "#123456");
  assert.deepEqual(pages.map((page) => page.id), ["p1"]);
});

test("pages flatten with one level of sub-pages", () => {
  const pages = [
    {id: "child", title: "Child", section_id: "section-a", parent_id: "root", order: 0},
    {id: "root", title: "Root", section_id: "section-a", order: 0},
    {id: "other", title: "Other", section_id: "section-b", order: 0}
  ];

  assert.deepEqual(flattenPages(pages, "section-a").map((page) => [page.id, page.depth]), [["root", 0], ["child", 1]]);
});

test("orphaned sub-pages are promoted in navigation", () => {
  const pages = [
    {id: "orphan", title: "Orphan", section_id: "section-a", parent_id: "missing", order: 1},
    {id: "root", title: "Root", section_id: "section-a", order: 0}
  ];

  assert.deepEqual(flattenPages(pages, "section-a").map((page) => [page.id, page.depth]), [["root", 0], ["orphan", 0]]);
});

test("reorderWithinSection swaps only siblings", () => {
  const pages = [
    {id: "a", title: "A", section_id: "s", order: 0},
    {id: "b", title: "B", section_id: "s", order: 1},
    {id: "c", title: "C", section_id: "s", parent_id: "a", order: 0}
  ];

  const updates = reorderWithinSection(pages, "b", -1);
  assert.deepEqual(updates.map((page) => [page.id, page.order]), [["b", 0], ["a", 1]]);
});

test("legacy sections and pages remain in the default workbook without changing IDs", () => {
  const {workbooks, sections, pages} = normalizeSopNotebook([
    {id: "section-existing", kind: "section", title: "Field"},
    {id: "page-existing", title: "Checklist", section_id: "section-existing"}
  ]);
  assert.equal(workbooks[0].id, DEFAULT_WORKBOOK_ID);
  assert.equal(workbooks[0].title, "SOP Library");
  assert.equal(sections[0].workbook_id, DEFAULT_WORKBOOK_ID);
  assert.equal(sections[0].id, "section-existing");
  assert.equal(pages[0].section_id, "section-existing");
});

test("saved workbooks own sections and are excluded from page lists", () => {
  const workbook = createWorkbookRecord({title: "Operations", order: 1});
  const section = createSectionRecord({title: "Maintenance", workbookId: workbook.id});
  const {workbooks, sections, pages} = normalizeSopNotebook([
    workbook, section,
    {id: "page", title: "Checklist", section_id: section.id},
    {id: "deleted-workbook", title: "Deleted", kind: "workbook", deleted: true}
  ]);
  assert.equal(isPageDoc(workbook), false);
  assert.deepEqual(workbooks.map((item) => item.id), [workbook.id]);
  assert.equal(sections[0].workbook_id, workbook.id);
  assert.deepEqual(pages.map((item) => item.id), ["page"]);
});

test("empty saved workbooks are retained and sections can move without changing page hierarchy", () => {
  const a = createWorkbookRecord({title: "A"});
  const b = createWorkbookRecord({title: "B", order: 1});
  const section = createSectionRecord({title: "Shared", workbookId: b.id});
  const docs = [a, b, section,
    {id: "root", title: "Root", section_id: section.id},
    {id: "child", title: "Child", section_id: section.id, parent_id: "root"}
  ];
  const notebook = normalizeSopNotebook(docs);
  assert.equal(notebook.workbooks.length, 2);
  assert.equal(notebook.sections.filter((item) => item.workbook_id === a.id).length, 0);
  assert.deepEqual(flattenPages(notebook.pages, section.id).map((page) => [page.id, page.depth]), [["root", 0], ["child", 1]]);
});

test("missing referenced workbooks are reconstructed without losing sections", () => {
  const {workbooks, sections} = normalizeSopNotebook([
    {id: "section", kind: "section", title: "Field", workbook_id: "workbook-field"}
  ]);
  assert.equal(workbooks[0].id, "workbook-field");
  assert.equal(sections[0].workbook_id, "workbook-field");
});

test("an existing page can become a subpage while keeping its own descendants", () => {
  const pages = [
    {id: "admin", title: "Admin", section_id: "s", order: 0},
    {id: "sla", title: "SLAs", section_id: "s", order: 1, content_html: "<p>Keep me</p>"},
    {id: "signature", title: "Signature", section_id: "s", parent_id: "sla", order: 0}
  ];
  const updates = movePageBranch(pages, pages[1], {sectionId: "s", parentId: "admin"});
  assert.equal(updates[0].parent_id, "admin");
  assert.equal(updates[0].content_html, "<p>Keep me</p>");
  const moved = pages.map((page) => updates.find((record) => record.id === page.id) || page);
  assert.deepEqual(flattenPages(moved, "s").map((page) => [page.id, page.depth]), [["admin", 0], ["sla", 1], ["signature", 2]]);
  assert.deepEqual(pageAncestors(moved, "signature").map((page) => page.id), ["sla", "admin"]);
});

test("moving across sections preserves nested parent links and appends after destination siblings", () => {
  const pages = [
    {id: "a", title: "A", section_id: "old", order: 0},
    {id: "b", title: "B", section_id: "old", parent_id: "a", order: 3},
    {id: "c", title: "C", section_id: "old", parent_id: "b", order: 2},
    {id: "target", title: "Target", section_id: "new", order: 0},
    {id: "sibling", title: "Sibling", section_id: "new", parent_id: "target", order: 8}
  ];
  const updates = movePageBranch(pages, pages[0], {sectionId: "new", parentId: "target"});
  assert.deepEqual(updates.map((page) => [page.id, page.section_id, page.parent_id, page.order]), [
    ["a", "new", "target", 9], ["b", "new", "a", 3], ["c", "new", "b", 2]
  ]);
  assert.deepEqual(descendantPages(pages, "a").map((page) => page.id), ["b", "c"]);
});

test("promotion clears the stored parent, and unchanged saves retain order", () => {
  const pages = [
    {id: "a", title: "A", section_id: "s", order: 5},
    {id: "b", title: "B", section_id: "s", parent_id: "a", order: 2}
  ];
  assert.equal(movePageBranch(pages, pages[1], {sectionId: "s"})[0].parent_id, null);
  assert.equal(movePageBranch(pages, pages[1], {sectionId: "s"})[0].order, 6);
  assert.equal(movePageBranch(pages, pages[1], {sectionId: "s", parentId: "a"})[0].order, 2);
});

test("page movement rejects cycles, missing parents and parents in another section", () => {
  const pages = [
    {id: "a", section_id: "s"},
    {id: "b", section_id: "s", parent_id: "a"},
    {id: "c", section_id: "s", parent_id: "b"},
    {id: "other", section_id: "other"}
  ];
  for (const parentId of ["a", "b", "c", "missing", "other"]) {
    assert.throws(() => movePageBranch(pages, pages[0], {sectionId: "s", parentId}));
  }
  assert.throws(() => movePageBranch(pages, pages[0], {sectionId: ""}));
  assert.deepEqual(descendantPages(pages, undefined), []);
  const cyclic = [{id: "a", section_id: "s", parent_id: "b"}, {id: "b", section_id: "s", parent_id: "a"}];
  assert.equal(flattenPages(cyclic, "s").length, 2);
});

test("only pages with live subpages count as parent pages", () => {
  const pages = [
    {id: "parent"},
    {id: "nested", parent_id: "parent"},
    {id: "leaf", parent_id: "nested"},
    {id: "empty"},
    {id: "deleted-child", parent_id: "empty", deleted: true}
  ];
  assert.equal(isParentPage(pages, "parent"), true);
  assert.equal(isParentPage(pages, "nested"), true);
  assert.equal(isParentPage(pages, "leaf"), false);
  assert.equal(isParentPage(pages, "empty"), false);
});
