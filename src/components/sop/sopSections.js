export const GENERAL_SECTION_ID = "section-general";
export const DEFAULT_WORKBOOK_ID = "workbook-sop-library";
export const SECTION_COLORS = ["#f97316", "#0ea5e9", "#22c55e", "#a855f7", "#eab308", "#ef4444", "#14b8a6", "#ec4899"];

export function slugifySection(value) {
  const slug = String(value || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "general";
}

export function legacySectionId(category) {
  return `section-${slugifySection(category || "general")}`;
}

export function sectionTitleFromCategory(category) {
  const title = String(category || "General").trim();
  return title || "General";
}

export function isSectionDoc(doc) {
  return Boolean(doc && doc.kind === "section");
}

export function isWorkbookDoc(doc) {
  return Boolean(doc && doc.kind === "workbook");
}

export function isPageDoc(doc) {
  return Boolean(doc && !doc.deleted && !isSectionDoc(doc) && !isWorkbookDoc(doc));
}

export function sectionForPage(page) {
  return page?.section_id || legacySectionId(page?.category || "General");
}

export function createWorkbookRecord({id, title, order = 0, now = new Date().toISOString(), user = ""}) {
  return {
    id: id || `workbook-${slugifySection(title)}`,
    kind: "workbook",
    title: String(title || "SOP Library").trim() || "SOP Library",
    order,
    created_by: user,
    created_date: now,
    updated_by: user,
    updated_date: now
  };
}

export function createSectionRecord({id, title, color, workbookId = DEFAULT_WORKBOOK_ID, order = 0, now = new Date().toISOString(), user = ""}) {
  return {
    id: id || legacySectionId(title),
    kind: "section",
    workbook_id: workbookId,
    title: sectionTitleFromCategory(title),
    color: color || SECTION_COLORS[Math.abs(order) % SECTION_COLORS.length],
    order,
    created_by: user,
    created_date: now,
    updated_by: user,
    updated_date: now
  };
}

export function normalizeSopNotebook(docs = []) {
  const liveDocs = docs.filter(Boolean);
  const liveSections = liveDocs.filter((doc) => !doc.deleted && isSectionDoc(doc));
  const livePages = liveDocs.filter(isPageDoc);
  const sectionsById = new Map();
  const workbooksById = new Map();
  liveDocs.filter((doc) => !doc.deleted && isWorkbookDoc(doc)).forEach((workbook, index) => {
    if (!workbook.id) return;
    workbooksById.set(workbook.id, {
      ...workbook,
      title: String(workbook.title || "SOP Library").trim() || "SOP Library",
      order: Number.isFinite(Number(workbook.order)) ? Number(workbook.order) : index
    });
  });

  liveSections.forEach((section, index) => {
    if (!section.id) return;
    sectionsById.set(section.id, {
      ...section,
      workbook_id: section.workbook_id || DEFAULT_WORKBOOK_ID,
      title: sectionTitleFromCategory(section.title),
      color: section.color || SECTION_COLORS[index % SECTION_COLORS.length],
      order: Number.isFinite(Number(section.order)) ? Number(section.order) : index
    });
  });

  livePages.forEach((page) => {
    const sectionId = sectionForPage(page);
    if (!sectionsById.has(sectionId)) {
      const title = sectionTitleFromCategory(page.category || (sectionId === GENERAL_SECTION_ID ? "General" : sectionId.replace(/^section-/, "")));
      sectionsById.set(sectionId, createSectionRecord({
        id: sectionId,
        title,
        color: SECTION_COLORS[sectionsById.size % SECTION_COLORS.length],
        order: sectionsById.size
      }));
    }
  });

  if (sectionsById.size === 0) {
    sectionsById.set(GENERAL_SECTION_ID, createSectionRecord({id: GENERAL_SECTION_ID, title: "General"}));
  }

  const sections = [...sectionsById.values()].sort(compareOrderThenTitle);
  sections.forEach((section) => {
    if (!workbooksById.has(section.workbook_id)) {
      workbooksById.set(section.workbook_id, createWorkbookRecord({
        id: section.workbook_id,
        title: section.workbook_id === DEFAULT_WORKBOOK_ID ? "SOP Library" : section.workbook_id.replace(/^workbook-/, ""),
        order: workbooksById.size
      }));
    }
  });
  const workbooks = [...workbooksById.values()].sort(compareOrderThenTitle);
  const pages = livePages
    .map((page, index) => ({
      ...page,
      section_id: sectionForPage(page),
      order: Number.isFinite(Number(page.order)) ? Number(page.order) : index,
      parent_id: page.parent_id || null
    }))
    .sort(compareOrderThenTitle);

  const sectionNames = Object.fromEntries(sections.map((section) => [section.id, section.title]));
  return {workbooks, sections, pages, sectionNames};
}

export function compareOrderThenTitle(a, b) {
  const order = (Number(a.order) || 0) - (Number(b.order) || 0);
  return order || String(a.title || "").localeCompare(String(b.title || ""));
}

export function pagesInSection(pages, sectionId) {
  return pages
    .filter((page) => page.section_id === sectionId)
    .sort(compareOrderThenTitle);
}

export function childrenOf(pages, parentId) {
  return pages.filter((page) => (page.parent_id || null) === (parentId || null)).sort(compareOrderThenTitle);
}

export function isParentPage(pages, pageId) {
  return pages.some((page) => !page.deleted && page.parent_id === pageId);
}

export function flattenPages(pages, sectionId) {
  const scoped = pagesInSection(pages, sectionId);
  const scopedIds = new Set(scoped.map((page) => page.id));
  const roots = scoped
    .filter((page) => !page.parent_id || !scopedIds.has(page.parent_id))
    .sort(compareOrderThenTitle);
  const flattened = [];
  const visited = new Set();
  const visit = (page, depth) => {
    if (visited.has(page.id)) return;
    visited.add(page.id);
    flattened.push({...page, depth});
    childrenOf(scoped, page.id).forEach((child) => visit(child, depth + 1));
  };
  roots.forEach((root) => visit(root, 0));
  scoped.forEach((page) => visit(page, 0));
  return flattened;
}

export function descendantPages(pages, pageId) {
  if (!pageId) return [];
  const descendants = [];
  const visited = new Set([pageId]);
  const visit = (parentId) => {
    childrenOf(pages, parentId).forEach((child) => {
      if (visited.has(child.id)) return;
      visited.add(child.id);
      descendants.push(child);
      visit(child.id);
    });
  };
  visit(pageId);
  return descendants;
}

export function pageAncestors(pages, pageId) {
  const ancestors = [];
  const visited = new Set([pageId]);
  let parentId = pages.find((page) => page.id === pageId)?.parent_id;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = pages.find((page) => page.id === parentId);
    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.parent_id;
  }
  return ancestors;
}

export function movePageBranch(pages, page, {sectionId, parentId = null}) {
  if (!sectionId) throw new Error("Choose a destination section.");
  const descendants = page.id ? descendantPages(pages, page.id) : [];
  if (parentId) {
    const parent = pages.find((item) => item.id === parentId);
    if (!parent || parent.section_id !== sectionId) throw new Error("Choose a parent page in the destination section.");
    if (parentId === page.id || descendants.some((item) => item.id === parentId)) {
      throw new Error("A page cannot be moved under itself or one of its subpages.");
    }
  }
  const current = pages.find((item) => item.id === page.id);
  const unchanged = (current || page).section_id === sectionId && ((current || page).parent_id || null) === parentId;
  const siblings = pages.filter((item) => item.id !== page.id && item.section_id === sectionId && (item.parent_id || null) === parentId);
  const order = unchanged ? page.order : Math.max(-1, ...siblings.map((item) => Number(item.order) || 0)) + 1;
  return [
    movePageRecord(page, {sectionId, parentId, order}),
    ...descendants.filter((child) => child.section_id !== sectionId).map((child) => movePageRecord(child, {sectionId, parentId: child.parent_id, order: child.order}))
  ];
}

export function reorderWithinSection(pages, pageId, direction) {
  const page = pages.find((item) => item.id === pageId);
  if (!page) return [];
  const siblings = pages
    .filter((item) => item.section_id === page.section_id && (item.parent_id || null) === (page.parent_id || null))
    .sort(compareOrderThenTitle);
  const index = siblings.findIndex((item) => item.id === pageId);
  const target = direction < 0 ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= siblings.length) return [];
  const reordered = [...siblings];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered.map((item, nextOrder) => ({...item, order: nextOrder}));
}

export function movePageRecord(page, {sectionId, parentId = null, order = 0}) {
  return {
    ...page,
    section_id: sectionId,
    parent_id: parentId,
    order
  };
}
