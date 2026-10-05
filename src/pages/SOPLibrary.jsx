import {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import DOMPurify from "dompurify";
import {format} from "date-fns";
import {ArchiveRestore, BookOpen, ExternalLink, History, Loader2, Pencil, Plus, RefreshCw, Trash2} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Card, CardContent} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {cn} from "@/lib/utils";
import {hasCollabBridge, sopsApi, subscribe} from "@/features/collab/collabApi";
import SopEditor, {isSafeUrl} from "@/components/sop/SopEditor";
import SopFilePreview from "@/components/sop/SopFilePreview";
import SopHistoryDialog from "@/components/sop/SopHistoryDialog";
import SopNotebookNav from "@/components/sop/SopNotebookNav";
import {
  compareOrderThenTitle,
  createSectionRecord,
  isSectionDoc,
  movePageRecord,
  normalizeSopNotebook,
  pagesInSection,
  reorderWithinSection,
  SECTION_COLORS
} from "@/components/sop/sopSections";

const SELECTION_KEY = "enquote:sop-library-selection";
const NAV_COLLAPSED_KEY = "enquote:sop-library-nav-collapsed";

function formatStamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? format(time, "MMM d, yyyy") : "";
}

function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ");
}

function matches(doc, terms, sectionName = "") {
  if (!terms.length) return true;
  const haystack = [doc.title, doc.summary, doc.category, sectionName, ...(doc.tags || []), stripHtml(doc.content_html), ...(doc.files || []).map((f) => f.name)]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function useSops() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    sopsApi.list()
      .then((items) => { if (!cancelled) setDocs(items.filter(Boolean)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    void sopsApi.sync();
    const off = subscribe("sops", "onChanged", (items) => { if (Array.isArray(items)) setDocs(items.filter(Boolean)); });
    return () => { cancelled = true; off(); };
  }, []);
  return {docs, loading};
}

function saveSelection(sectionId, pageId) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({sectionId, pageId}));
  } catch {
    // localStorage can be unavailable in hardened WebViews.
  }
}

function loadSelection() {
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY) || "{}");
  } catch {
    return {};
  }
}

function loadNavCollapsed() {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveNavCollapsed(value) {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, value ? "true" : "false");
  } catch {
    // localStorage can be unavailable in hardened WebViews.
  }
}

function SopViewer({doc, sectionName, onEdit, onHistory, onDelete}) {
  const html = useMemo(() => DOMPurify.sanitize(doc.content_html || ""), [doc.content_html]);
  const hasContent = stripHtml(doc.content_html).trim().length > 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground">{doc.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{sectionName || doc.category || "General"}</Badge>
            {(doc.tags || []).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
            <span>Updated {formatStamp(doc.updated_date)}{doc.updated_by ? ` by ${doc.updated_by}` : ""}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSafeUrl(doc.source_url) && (
            <Button variant="outline" size="sm" onClick={() => window.open(doc.source_url.trim(), "_blank")}>
              <ExternalLink className="mr-1 h-4 w-4" /> Open original
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onHistory}><History className="mr-1 h-4 w-4" /> History</Button>
          <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>
      {doc.summary && <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">{doc.summary}</p>}
      {hasContent && <div className="sop-content" dangerouslySetInnerHTML={{__html: html}} />}
      {(doc.files || []).map((file) => <SopFilePreview key={file.fileId} file={file} />)}
      {!hasContent && !(doc.files || []).length && !doc.summary && (
        <p className="text-sm text-muted-foreground">This SOP has no content yet. Click Edit to add some.</p>
      )}
    </div>
  );
}

export default function SOPLibraryPage() {
  const {docs, loading} = useSops();
  const location = useLocation();
  const navigate = useNavigate();
  const querySelectedId = new URLSearchParams(location.search).get("doc");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [sectionDelete, setSectionDelete] = useState(null);
  const [deleteTargetSection, setDeleteTargetSection] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selection, setSelection] = useState(() => loadSelection());
  const [navCollapsed, setNavCollapsedState] = useState(() => loadNavCollapsed());
  const savedSynthetic = useRef(new Set());

  const nonPurged = useMemo(() => docs.filter(Boolean), [docs]);
  const deleted = useMemo(
    () => nonPurged.filter((doc) => doc.deleted).sort((a, b) => String(b.updated_date).localeCompare(String(a.updated_date))),
    [nonPurged]
  );
  const activeRecords = useMemo(() => nonPurged.filter((doc) => !doc.deleted), [nonPurged]);
  const {sections, pages, sectionNames} = useMemo(() => normalizeSopNotebook(nonPurged), [nonPurged]);
  const selectedId = querySelectedId || selection.pageId || "";
  const selected = pages.find((doc) => doc.id === selectedId) || null;
  const selectedSectionId = selected?.section_id || selection.sectionId || sections[0]?.id || "";
  const selectedSection = sections.find((section) => section.id === selectedSectionId) || sections[0] || null;
  const categories = useMemo(() => sections.map((section) => section.title).sort((a, b) => a.localeCompare(b)), [sections]);
  const terms = useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);
  const searchResults = useMemo(
    () => pages.filter((doc) => matches(doc, terms, sectionNames[doc.section_id])).sort(compareOrderThenTitle),
    [pages, sectionNames, terms]
  );

  useEffect(() => {
    if (loading || !hasCollabBridge()) return;
    const realSectionIds = new Set(activeRecords.filter(isSectionDoc).map((doc) => doc.id));
    const missing = sections.filter((section) => !realSectionIds.has(section.id) && !savedSynthetic.current.has(section.id));
    missing.forEach((section) => {
      savedSynthetic.current.add(section.id);
      void sopsApi.save(section).catch(() => savedSynthetic.current.delete(section.id));
    });
  }, [activeRecords, loading, sections]);

  useEffect(() => {
    if (!querySelectedId && selectedId) navigate(`/SOPLibrary?doc=${encodeURIComponent(selectedId)}`, {replace: true});
  }, [navigate, querySelectedId, selectedId]);

  const rememberSelection = (sectionId, pageId) => {
    const next = {sectionId: sectionId || "", pageId: pageId || ""};
    setSelection(next);
    saveSelection(next.sectionId, next.pageId);
  };

  const setNavCollapsed = (value) => {
    setNavCollapsedState(value);
    saveNavCollapsed(value);
  };

  const select = (id) => {
    const page = pages.find((doc) => doc.id === id);
    setEditing(null);
    rememberSelection(page?.section_id || selectedSection?.id || selectedSectionId, id || "");
    navigate(id ? `/SOPLibrary?doc=${encodeURIComponent(id)}` : "/SOPLibrary", {replace: true});
  };

  const selectSection = (sectionId) => {
    setEditing(null);
    rememberSelection(sectionId, "");
    navigate("/SOPLibrary", {replace: true});
  };

  const refresh = async () => {
    setRefreshing(true);
    await sopsApi.sync();
    setRefreshing(false);
  };

  const saveMany = async (records) => {
    await Promise.all(records.map((record) => sopsApi.save(record, {force: true})));
  };

  const sectionPageCount = (sectionId) => pages.filter((page) => page.section_id === sectionId).length;

  const createSection = async () => {
    const title = window.prompt("Section name");
    if (!title?.trim()) return;
    const base = createSectionRecord({title: title.trim(), order: sections.length});
    const record = sections.some((section) => section.id === base.id) ? {...base, id: `${base.id}-${Date.now()}`} : base;
    try {
      const result = await sopsApi.save(record, {force: true});
      toast.success("Section created");
      selectSection(result?.record?.id || record.id);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const renameSection = async (sectionId) => {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return;
    const title = window.prompt("Rename section", section.title);
    if (!title?.trim() || title.trim() === section.title) return;
    try {
      await sopsApi.save({...section, title: title.trim()}, {force: true});
      toast.success("Section renamed");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const recolorSection = async (sectionId) => {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return;
    const index = SECTION_COLORS.indexOf(section.color);
    try {
      await sopsApi.save({...section, color: SECTION_COLORS[(index + 1) % SECTION_COLORS.length]}, {force: true});
    } catch (error) {
      toast.error(error.message);
    }
  };

  const moveSection = async (sectionId, direction) => {
    const ordered = [...sections].sort(compareOrderThenTitle);
    const index = ordered.findIndex((section) => section.id === sectionId);
    const target = direction < 0 ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    try {
      await saveMany(ordered.map((section, order) => ({...section, order})));
    } catch (error) {
      toast.error(error.message);
    }
  };

  const askDeleteSection = (sectionId) => {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return;
    const fallback = sections.find((item) => item.id !== sectionId)?.id || "";
    setDeleteTargetSection(fallback);
    setSectionDelete(section);
  };

  const deleteSection = async (mode) => {
    if (!sectionDelete) return;
    const movingPages = pages.filter((page) => page.section_id === sectionDelete.id);
    try {
      if (mode === "move" && deleteTargetSection) {
        await saveMany(movingPages.map((page, order) => movePageRecord(page, {sectionId: deleteTargetSection, order})));
      } else if (mode === "delete") {
        await Promise.all(movingPages.map((page) => sopsApi.delete(page.id)));
      }
      await sopsApi.delete(sectionDelete.id);
      toast.success("Section deleted");
      selectSection(deleteTargetSection || sections.find((item) => item.id !== sectionDelete.id)?.id || "");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSectionDelete(null);
    }
  };

  const createPage = (sectionId) => {
    const section = sections.find((item) => item.id === sectionId) || selectedSection;
    const rootCount = pages.filter((page) => page.section_id === section?.id && !page.parent_id).length;
    setEditing({section_id: section?.id, category: section?.title || "General", order: rootCount});
  };

  const createSubPage = (page) => {
    if (!page || page.parent_id) return;
    const childCount = pages.filter((item) => item.parent_id === page.id).length;
    setEditing({section_id: page.section_id, parent_id: page.id, category: sectionNames[page.section_id] || page.category || "General", order: childCount});
  };

  const movePage = async (pageId, direction) => {
    const updates = reorderWithinSection(pages, pageId, direction);
    if (!updates.length) return;
    try {
      await saveMany(updates);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const movePageToSection = async (page, sectionId) => {
    if (!page || page.section_id === sectionId) return;
    const newOrder = pagesInSection(pages, sectionId).filter((item) => !item.parent_id).length;
    const descendants = pages.filter((item) => item.parent_id === page.id);
    try {
      await saveMany([
        movePageRecord(page, {sectionId, order: newOrder}),
        ...descendants.map((child, order) => movePageRecord(child, {sectionId, parentId: page.id, order}))
      ]);
      rememberSelection(sectionId, page.id);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const remove = async () => {
    const target = confirmDelete || selected;
    if (!target) return;
    try {
      const childUpdates = pages
        .filter((page) => page.parent_id === target.id)
        .map((page, order) => movePageRecord(page, {sectionId: target.section_id, parentId: null, order}));
      if (childUpdates.length) await saveMany(childUpdates);
      await sopsApi.delete(target.id);
      toast.success(`Deleted "${target.title}"`, {
        action: {label: "Undo", onClick: () => restoreDeleted(target)}
      });
      if (target.id === selected?.id) select("");
    } catch (error) {
      toast.error(error.message);
    }
  };

  async function restoreDeleted(doc) {
    try {
      await sopsApi.save(doc, {force: true});
      toast.success(`Restored "${doc.title}"`);
      if (isSectionDoc(doc)) {
        selectSection(doc.id);
      } else {
        select(doc.id);
      }
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (!hasCollabBridge()) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">The SOP Library is available in the EnQuote desktop app.</CardContent></Card>
      </div>
    );
  }

  let detail;
  if (editing) {
    detail = (
      <SopEditor
        key={editing.id || `${editing.section_id || "new"}-${editing.parent_id || "root"}`}
        doc={editing.id ? editing : {...editing, title: "", files: []}}
        categories={categories}
        onCancel={() => setEditing(null)}
        onSaved={(result) => { setEditing(null); if (result?.id) select(result.id); }}
      />
    );
  } else if (selected) {
    detail = (
      <SopViewer
        doc={selected}
        sectionName={sectionNames[selected.section_id]}
        onEdit={() => setEditing(selected)}
        onHistory={() => setHistoryOpen(true)}
        onDelete={() => setConfirmDelete(selected)}
      />
    );
  } else {
    detail = (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <BookOpen className="mb-3 h-10 w-10 text-muted-foreground/60" />
        <p className="text-sm">Pick a page, or add one to the selected section.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><BookOpen className="h-6 w-6 text-primary" />SOP Library</h1>
          <p className="text-sm text-muted-foreground">OneNote-style sections and pages. Changes sync when the desktop app is online and keep working from cached data offline.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn("mr-1 h-4 w-4", refreshing && "animate-spin")} /> Refresh
          </Button>
          <Button onClick={() => createPage(selectedSection?.id || selectedSectionId)}><Plus className="mr-1 h-4 w-4" />New page</Button>
        </div>
      </div>

      <div className={cn("grid gap-4 xl:gap-5", navCollapsed ? "xl:grid-cols-[4rem_1fr]" : "xl:grid-cols-[24rem_1fr]")}>
        <SopNotebookNav
          sections={sections}
          pages={pages}
          selectedSectionId={selectedSection?.id || selectedSectionId}
          selectedPageId={selected?.id || ""}
          search={search}
          searchResults={searchResults}
          sectionNames={sectionNames}
          collapsed={navCollapsed}
          onCollapsedChange={setNavCollapsed}
          onSearchChange={setSearch}
          onSelectSection={selectSection}
          onSelectPage={select}
          onCreateSection={createSection}
          onRenameSection={renameSection}
          onRecolorSection={recolorSection}
          onMoveSection={moveSection}
          onDeleteSection={askDeleteSection}
          onCreatePage={createPage}
          onCreateSubPage={createSubPage}
          onMovePage={movePage}
          onMovePageToSection={movePageToSection}
          onDeletePage={setConfirmDelete}
        />

        <Card>
          <CardContent className="p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : detail}
          </CardContent>
        </Card>
      </div>

      {deleted.length > 0 && (
        <Card>
          <CardContent className="p-2.5">
            <button type="button" className="text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowDeleted((value) => !value)}>
              {showDeleted ? "Hide" : "Show"} recently deleted ({deleted.length})
            </button>
            {showDeleted && (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {deleted.slice(0, 30).map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <span className="truncate">{isSectionDoc(doc) ? `Section: ${doc.title}` : doc.title}</span>
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => restoreDeleted(doc)}>
                      <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {selected && <SopHistoryDialog doc={selected} open={historyOpen} onOpenChange={setHistoryOpen} />}

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this SOP page?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.title}" will be removed for everyone. It can be restored from "Recently deleted".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(sectionDelete)} onOpenChange={(open) => { if (!open) setSectionDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section "{sectionDelete?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This section has {sectionDelete ? sectionPageCount(sectionDelete.id) : 0} page(s). Move them to another section, or delete the pages too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {sections.some((section) => section.id !== sectionDelete?.id) && (
            <Select value={deleteTargetSection} onValueChange={setDeleteTargetSection}>
              <SelectTrigger><SelectValue placeholder="Move pages to..." /></SelectTrigger>
              <SelectContent>
                {sections.filter((section) => section.id !== sectionDelete?.id).map((section) => (
                  <SelectItem key={section.id} value={section.id}>{section.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => deleteSection("move")} disabled={!deleteTargetSection}>Move pages and delete section</Button>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteSection("delete")}>Delete pages too</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
