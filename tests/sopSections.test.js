import test from "node:test";
import assert from "node:assert/strict";
import {
  flattenPages,
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
