import {useEffect, useMemo, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import DOMPurify from "dompurify";
import {format} from "date-fns";
import {
  ArchiveRestore,
  BookOpen,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
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

const ALL = "__all__";

function formatStamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? format(time, "MMM d, yyyy") : "";
}

function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ");
}

function matches(doc, terms) {
  if (!terms.length) return true;
  const haystack = [doc.title, doc.summary, doc.category, ...(doc.tags || []), stripHtml(doc.content_html), ...(doc.files || []).map((f) => f.name)]
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
      .then((items) => { if (!cancelled) setDocs(items); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    void sopsApi.sync();
    const off = subscribe("sops", "onChanged", (items) => { if (Array.isArray(items)) setDocs(items); });
    return () => { cancelled = true; off(); };
  }, []);
  return {docs, loading};
}

function SopViewer({doc, onEdit, onHistory, onDelete}) {
  const html = useMemo(() => DOMPurify.sanitize(doc.content_html || ""), [doc.content_html]);
  const hasContent = stripHtml(doc.content_html).trim().length > 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-800">{doc.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant="outline">{doc.category || "General"}</Badge>
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
          <Button variant="outline" size="sm" onClick={onDelete} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>
      {doc.summary && <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">{doc.summary}</p>}
      {hasContent && <div className="sop-content" dangerouslySetInnerHTML={{__html: html}} />}
      {(doc.files || []).map((file) => <SopFilePreview key={file.fileId} file={file} />)}
      {!hasContent && !(doc.files || []).length && !doc.summary && (
        <p className="text-sm text-slate-500">This SOP has no content yet. Click Edit to add some.</p>
      )}
    </div>
  );
}

export default function SOPLibraryPage() {
  const {docs, loading} = useSops();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedId = new URLSearchParams(location.search).get("doc");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editing, setEditing] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const active = useMemo(() => docs.filter((doc) => !doc.deleted), [docs]);
  const deleted = useMemo(
    () => docs.filter((doc) => doc.deleted).sort((a, b) => String(b.updated_date).localeCompare(String(a.updated_date))),
    [docs]
  );
  const categories = useMemo(
    () => [...new Set(active.map((doc) => doc.category || "General"))].sort((a, b) => a.localeCompare(b)),
    [active]
  );
  const visible = useMemo(() => {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return active
      .filter((doc) => category === ALL || (doc.category || "General") === category)
      .filter((doc) => matches(doc, terms))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [active, search, category]);
  const selected = docs.find((doc) => doc.id === selectedId) || null;

  const select = (id) => {
    setEditing(null);
    navigate(id ? `/SOPLibrary?doc=${encodeURIComponent(id)}` : "/SOPLibrary", {replace: true});
  };

  const refresh = async () => {
    setRefreshing(true);
    await sopsApi.sync();
    setRefreshing(false);
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await sopsApi.delete(selected.id);
      toast.success(`Deleted "${selected.title}"`, {
        action: {label: "Undo", onClick: () => restoreDeleted(selected)}
      });
      select(null);
    } catch (error) {
      toast.error(error.message);
    }
  };

  async function restoreDeleted(doc) {
    try {
      // The main process drops the list-only fields (deleted, updated_*) before saving.
      await sopsApi.save(doc, {force: true});
      toast.success(`Restored "${doc.title}"`);
      select(doc.id);
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (!hasCollabBridge()) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">The SOP Library is available in the EnQuote desktop app.</CardContent></Card>
      </div>
    );
  }

  let detail;
  if (editing) {
    detail = (
      <SopEditor
        key={editing === "new" ? "new" : editing.id}
        doc={editing === "new" ? null : editing}
        categories={categories}
        onCancel={() => setEditing(null)}
        onSaved={(record) => { setEditing(null); if (record?.id) select(record.id); }}
      />
    );
  } else if (selected?.deleted) {
    detail = (
      <div className="space-y-4 text-center">
        <p className="text-sm text-slate-600">"{selected.title}" was deleted{selected.updated_by ? ` by ${selected.updated_by}` : ""}.</p>
        <Button onClick={() => restoreDeleted(selected)} className="bg-orange-600 hover:bg-orange-700"><ArchiveRestore className="mr-1 h-4 w-4" /> Restore</Button>
      </div>
    );
  } else if (selected) {
    detail = (
      <SopViewer
        doc={selected}
        onEdit={() => setEditing(selected)}
        onHistory={() => setHistoryOpen(true)}
        onDelete={() => setConfirmDelete(true)}
      />
    );
  } else {
    detail = (
      <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
        <BookOpen className="mb-3 h-10 w-10 text-slate-300" />
        <p className="text-sm">Pick an SOP on the left, or add a new one.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><BookOpen className="h-6 w-6 text-orange-600" />SOP Library</h1>
          <p className="text-sm text-muted-foreground">Team procedures. Anyone can add or edit; every change is kept in the history.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn("mr-1 h-4 w-4", refreshing && "animate-spin")} /> Refresh
          </Button>
          <Button onClick={() => setEditing("new")} className="bg-orange-600 text-white hover:bg-orange-700"><Plus className="mr-1 h-4 w-4" />New SOP</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardContent className="space-y-3 p-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SOPs" className="pl-8" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
            ) : visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">{active.length ? "No SOPs match your search." : "No SOPs yet."}</p>
            ) : (
              <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
                {visible.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => select(doc.id)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors",
                        doc.id === selectedId ? "border-orange-300 bg-orange-50" : "border-transparent hover:bg-slate-50"
                      )}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                        <span className="truncate">{doc.title}</span>
                      </div>
                      <div className="mt-0.5 truncate pl-6 text-xs text-slate-500">{doc.category || "General"}{doc.summary ? ` · ${doc.summary}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {deleted.length > 0 && (
              <div className="border-t border-slate-200 pt-3">
                <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-700" onClick={() => setShowDeleted((value) => !value)}>
                  {showDeleted ? "Hide" : "Show"} recently deleted ({deleted.length})
                </button>
                {showDeleted && (
                  <ul className="mt-2 space-y-1">
                    {deleted.slice(0, 25).map((doc) => (
                      <li key={doc.id} className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="truncate">{doc.title}</span>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => restoreDeleted(doc)}>
                          <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Restore
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">{detail}</CardContent>
        </Card>
      </div>

      {selected && !selected.deleted && (
        <SopHistoryDialog doc={selected} open={historyOpen} onOpenChange={setHistoryOpen} />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this SOP?</AlertDialogTitle>
            <AlertDialogDescription>
              "{selected?.title}" will be removed for everyone. It can be restored from "Recently deleted".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
