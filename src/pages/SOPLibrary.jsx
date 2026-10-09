import {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {format} from "date-fns";
import {ArchiveRestore, BookOpen, ExternalLink, History, Loader2, Pencil, Plus, RefreshCw, Trash2} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Card, CardContent} from "@/components/ui/card";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
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
import SopOneNoteImport from "@/components/sop/SopOneNoteImport";
import SopRichContent from "@/components/sop/SopRichContent";
import {
  compareOrderThenTitle,
  createSectionRecord,
  isSectionDoc,
  isWorkbookDoc,
  movePageBranch,
  movePageRecord,
  normalizeSopNotebook,
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
      .catch((error) => { if (!cancelled && hasCollabBridge()) toast.error(error.message || "Could not load SOP pages."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    void sopsApi.sync();
    const off = subscribe("sops", "onChanged", (items) => { if (Array.isArray(items)) setDocs(items.filter(Boolean)); });
    return () => { cancelled = true; off(); };
  }, []);
  return {docs, loading};
}

function saveSelection(sectionId, pageId, workbookId) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({sectionId, pageId, workbookId}));
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
            <Button variant="outline" size="sm" asChild>
              <a href={doc.source_url.trim()} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Open original
              </a>
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
      {hasContent && <SopRichContent html={doc.content_html} />}
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
  const [sectionEditor, setSectionEditor] = useState(null);
  const [sectionTitle, setSectionTitle] = useState("");
  const [savingSection, setSavingSection] = useState(false);
  const [deleteTargetSection, setDeleteTargetSection] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selection, setSelection] = useState(() => loadSelection());
  const [navCollapsed, setNavCollapsedState] = useState(() => loadNavCollapsed());
  const savedSynthetic = useRef(new Set());

  const nonPurged = useMemo(() => docs.filter(Boolean), [docs]);
  const deleted = useMemo(
    () => nonPurged.filter((doc) => doc.deleted && !isWorkbookDoc(doc)).sort((a, b) => String(b.updated_date).localeCompare(String(a.updated_date))),
    [nonPurged]
  );
  const activeRecords = useMemo(() => nonPurged.filter((doc) => !doc.deleted), [nonPurged]);
  const {workbooks, sections, pages, sectionNames} = useMemo(() => normalizeSopNotebook(nonPurged), [nonPurged]);
  const selectedId = querySelectedId || selection.pageId || "";
  const selected = pages.find((doc) => doc.id === selectedId) || null;
  const selectedSection = sections.find((section) => section.id === (selected?.section_id || selection.sectionId)) || sections[0] || null;
  const selectedSectionId = selectedSection?.id || "";
  const categories = useMemo(() => sections.map((section) => section.title).sort((a, b) => a.localeCompare(b)), [sections]);
  const searchSectionNames = sectionNames;
  const terms = useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);
  const searchResults = useMemo(
    () => pages.filter((doc) => matches(doc, terms, searchSectionNames[doc.section_id])).sort(compareOrderThenTitle),
    [pages, searchSectionNames, terms]
  );

  useEffect(() => {
    if (loading || !hasCollabBridge()) return;
    const realIds = new Set(activeRecords.map((doc) => doc.id));
    const missing = sections.filter((record) => !realIds.has(record.id) && !savedSynthetic.current.has(record.id));
    missing.forEach((record) => {
      savedSynthetic.current.add(record.id);
      void sopsApi.save(record).catch((error) => {
        savedSynthetic.current.delete(record.id);
        toast.error(error.message || "Could not save the default SOP navigation.");
      });
    });
  }, [activeRecords, loading, sections]);

  useEffect(() => {
    if (!querySelectedId && selectedId) navigate(`/SOPLibrary?doc=${encodeURIComponent(selectedId)}`, {replace: true});
  }, [navigate, querySelectedId, selectedId]);

  const rememberSelection = (sectionId, pageId, workbookId) => {
    const next = {
      sectionId: sectionId || "",
      pageId: pageId || "",
      workbookId: workbookId || sections.find((section) => section.id === sectionId)?.workbook_id || ""
    };
    setSelection(next);
    saveSelection(next.sectionId, next.pageId, next.workbookId);
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
    setSearch("");
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

  const createSection = () => {
    setSectionTitle("");
    setSectionEditor({mode: "create", entity: "section"});
  };

  const renameSection = (sectionId) => {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return;
    setSectionTitle(section.title);
    setSectionEditor({mode: "rename", entity: "section", record: section});
  };

  const saveSection = async (event) => {
    event.preventDefault();
    if (!sectionEditor || savingSection) return;
    const title = sectionTitle.trim();
    const entity = sectionEditor.entity;
    if (!title) {
      toast.error(`Give the ${entity} a name.`);
      return;
    }
    const renaming = sectionEditor.mode === "rename";
    if (renaming && title === sectionEditor.record.title) {
      setSectionEditor(null);
      return;
    }
    const base = renaming
      ? {...sectionEditor.record, title}
      : createSectionRecord({title, order: sections.length});
    const record = !renaming && [...nonPurged, ...sections, ...workbooks].some((doc) => doc.id === base.id)
      ? {...base, id: `${base.id}-${crypto.randomUUID()}`}
      : base;
    setSavingSection(true);
    try {
      const result = await sopsApi.save(record, {force: true});
      if (result?.ok === false) throw new Error(`The ${entity} changed while saving. Please try again.`);
      toast.success(`Section ${renaming ? "updated" : "created"}`);
      setSectionEditor(null);
      if (!renaming) {
        rememberSelection(result?.record?.id || record.id, "", record.workbook_id);
        navigate("/SOPLibrary", {replace: true});
      }
    } catch (error) {
      toast.error(error.message || `Could not save the ${entity}.`);
    } finally {
      setSavingSection(false);
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
        await saveMany(movingPages.map((page, order) => movePageRecord(page, {sectionId: deleteTargetSection, parentId: page.parent_id || null, order})));
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
    if (!section) {
      toast.error("Add a section before adding a page.");
      return;
    }
    const rootCount = pages.filter((page) => page.section_id === section?.id && !page.parent_id).length;
    setEditing({section_id: section?.id, category: section?.title || "General", order: rootCount});
  };

  const createSubPage = (page) => {
    if (!page) return;
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

  const movePageToParent = async (page, parentId) => {
    let savedPage = false;
    try {
      const current = pages.find((item) => item.id === page.id);
      const parent = pages.find((item) => item.id === parentId);
      if (!current || !parent) throw new Error("That page is no longer available. Refresh and try again.");
      const updates = movePageBranch(pages, current, {sectionId: parent.section_id, parentId});
      for (const record of updates) {
        const result = await sopsApi.save(record, {baseUpdatedAt: record.updated_date});
        if (result?.ok === false) throw new Error(`"${record.title}" changed while moving. Please try again.`);
        savedPage = true;
      }
      setEditing(null);
      setSearch("");
      rememberSelection(parent.section_id, current.id);
      navigate(`/SOPLibrary?doc=${encodeURIComponent(current.id)}`, {replace: true});
      toast.success(`Moved "${current.title}" under "${parent.title}"`);
    } catch (error) {
      toast.error(savedPage ? `${error.message} Some pages were moved. Use Edit and Save to retry moving remaining subpages.` : error.message);
    }
  };

  const remove = async () => {
    const target = confirmDelete || selected;
    if (!target) return;
    try {
      const childUpdates = pages
        .filter((page) => page.parent_id === target.id)
        .map((page, order) => movePageRecord(page, {sectionId: target.section_id, parentId: target.parent_id || null, order}));
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
        sections={sections}
        pages={pages}
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
      <div className="flex min-h-full flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <BookOpen className="mb-3 h-10 w-10 text-muted-foreground/60" />
        <p className="text-sm">Pick a page, or add one to the selected section.</p>
      </div>
    );
  }

  return (
    <div data-testid="sop-workspace" className="flex min-h-0 w-full flex-1 flex-col gap-3 p-3 sm:p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pr-14">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><BookOpen className="h-6 w-6 text-primary" />SOP Library</h1>
          <p className="text-sm text-muted-foreground">Sections, parent pages and subpages. Changes sync when the desktop app is online and keep working from cached data offline.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SopOneNoteImport sections={sections} selectedSectionId={selectedSectionId} onImported={(sectionId, parentPageId) => { if (parentPageId) select(parentPageId); else selectSection(sectionId); }} />
          <Button variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn("mr-1 h-4 w-4", refreshing && "animate-spin")} /> Refresh
          </Button>
          <Button disabled={!selectedSection} onClick={() => createPage(selectedSectionId)}><Plus className="mr-1 h-4 w-4" />New page</Button>
        </div>
      </div>

      <div className={cn("grid min-h-0 flex-1 gap-3", navCollapsed ? "grid-cols-[3.5rem_minmax(0,1fr)]" : "grid-rows-[minmax(10rem,35%)_minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[27rem_minmax(0,1fr)]")}>
        <SopNotebookNav
          sections={sections}
          allSections={sections}
          pages={pages}
          selectedSectionId={selectedSection?.id || selectedSectionId}
          selectedPageId={selected?.id || ""}
          search={search}
          searchResults={searchResults}
          sectionNames={searchSectionNames}
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
          onMovePageToParent={movePageToParent}
          onDeletePage={setConfirmDelete}
        />

        <Card data-testid="sop-detail" className="min-h-0 min-w-0 overflow-auto">
          <CardContent className="min-h-full p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : detail}
          </CardContent>
        </Card>
      </div>

      {deleted.length > 0 && (
        <Card className="max-h-[25vh] shrink-0 overflow-auto">
          <CardContent className="p-2.5">
            <button type="button" className="text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowDeleted((value) => !value)}>
              {showDeleted ? "Hide" : "Show"} recently deleted ({deleted.length})
            </button>
            {showDeleted && (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {deleted.slice(0, 30).map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <span className="truncate">{isWorkbookDoc(doc) ? `Workbook: ${doc.title}` : isSectionDoc(doc) ? `Section: ${doc.title}` : doc.title}</span>
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

      <Dialog open={Boolean(sectionEditor)} onOpenChange={(open) => { if (!open && !savingSection) setSectionEditor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sectionEditor?.mode === "rename" ? "Edit" : "Add"} section</DialogTitle>
            <DialogDescription>Organize your SOP pages with a named section.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSection} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sop-section-name">Section name</Label>
              <Input id="sop-section-name" autoFocus maxLength={200} value={sectionTitle} disabled={savingSection} onChange={(event) => setSectionTitle(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={savingSection} onClick={() => setSectionEditor(null)}>Cancel</Button>
              <Button type="submit" disabled={savingSection || !sectionTitle.trim()}>
                {savingSection && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {sectionEditor?.mode === "rename" ? "Save" : "Create"} {sectionEditor?.entity || "section"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
