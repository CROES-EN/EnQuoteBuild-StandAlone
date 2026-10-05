export const GENERAL_SECTION_ID = "section-general";
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

export function isPageDoc(doc) {
  return Boolean(doc && !doc.deleted && !isSectionDoc(doc));
}

export function sectionForPage(page) {
  return page?.section_id || legacySectionId(page?.category || "General");
}

export function createSectionRecord({id, title, color, order = 0, now = new Date().toISOString(), user = ""}) {
  return {
    id: id || legacySectionId(title),
    kind: "section",
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

  liveSections.forEach((section, index) => {
    if (!section.id) return;
    sectionsById.set(section.id, {
      ...section,
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
  const pages = livePages
    .map((page, index) => ({
      ...page,
      section_id: sectionForPage(page),
      order: Number.isFinite(Number(page.order)) ? Number(page.order) : index,
      parent_id: page.parent_id || null
    }))
    .sort(compareOrderThenTitle);

  const sectionNames = Object.fromEntries(sections.map((section) => [section.id, section.title]));
  return {sections, pages, sectionNames};
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

export function flattenPages(pages, sectionId) {
  const scoped = pagesInSection(pages, sectionId);
  const scopedIds = new Set(scoped.map((page) => page.id));
  const roots = scoped
    .filter((page) => !page.parent_id || !scopedIds.has(page.parent_id))
    .sort(compareOrderThenTitle);
  const flattened = [];
  roots.forEach((root) => {
    flattened.push({...root, depth: 0});
    childrenOf(scoped, root.id).forEach((child) => flattened.push({...child, depth: 1}));
  });
  return flattened;
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
