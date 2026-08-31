import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { createLocalRecord, deleteLocalRecord, getCurrentUser, listLocalCollection, updateLocalRecord } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Siren, ShieldAlert, AlertTriangle, CheckCircle2, RefreshCw,
  Upload, Plus, Trash2, User, Calendar, Filter, Clock } from
"lucide-react";
import { format, subDays, isAfter, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import RoleGuard from "@/components/auth/RoleGuard";
import SiteQuoteTracker from "@/components/flags/SiteQuoteTracker";

const FLAG_STYLES = {
  red: { bg: "bg-red-100", text: "text-red-800", border: "border-red-300", icon: Siren, label: "Critical Review" },
  orange: { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-300", icon: ShieldAlert, label: "Level 2 Warning" },
  yellow: { bg: "bg-yellow-100", text: "text-yellow-900", border: "border-yellow-300", icon: AlertTriangle, label: "Level 1 Warning" }
};

function computeFlagLevel(truckrollCount, supportCount) {
  // Truckroll rules: 2=yellow, 3=orange, 4+=red
  let truckrollLevel = null;
  if (truckrollCount >= 4) truckrollLevel = "red";else
  if (truckrollCount >= 3) truckrollLevel = "orange";else
  if (truckrollCount >= 2) truckrollLevel = "yellow";

  // Support rules: 2+=yellow, 3+=orange, 4+/same-day=red
  let supportLevel = null;
  if (supportCount >= 4) supportLevel = "red";else
  if (supportCount >= 3) supportLevel = "orange";else
  if (supportCount >= 2) supportLevel = "yellow";

  const levels = ["yellow", "orange", "red"];
  const maxLevel = [truckrollLevel, supportLevel].
  filter(Boolean).
  sort((a, b) => levels.indexOf(b) - levels.indexOf(a))[0];

  return maxLevel || null;
}

function FlagCard({ flag, onResolve, onDelete }) {
  const [showResolve, setShowResolve] = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const cfg = FLAG_STYLES[flag.flag_level];
  const Icon = cfg.icon;

  return (
    <Card className={cn("border-2", cfg.border, flag.is_resolved ? "opacity-60" : "")}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className={cn("p-2 rounded-lg", cfg.bg)}>
              <Icon className={cn("w-5 h-5", cfg.text)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-lg font-bold text-slate-900">{flag.site_id}</span>
                <Badge className={cn(cfg.bg, cfg.text, "border-0 text-xs")}>{cfg.label}</Badge>
                {flag.is_resolved && <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">Resolved</Badge>}
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-2">
                {flag.truckroll_count > 0 &&
                <span>🚛 <strong>{flag.truckroll_count}</strong> truckroll cancellations</span>
                }
                {flag.support_contact_count > 0 &&
                <span>📞 <strong>{flag.support_contact_count}</strong> support contacts (10d window)</span>
                }
                <span className="capitalize">Source: <strong>{flag.flag_source === "both" ? "Truckroll + Support" : flag.flag_source}</strong></span>
              </div>
              {flag.notes &&
              <p className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2 mb-2">{flag.notes}</p>
              }
              {flag.is_resolved && flag.resolved_notes &&
              <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-2">
                  <strong>Resolution:</strong> {flag.resolved_notes}
                </p>
              }
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                {flag.created_date &&
                <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Flagged {format(new Date(flag.created_date), "MMM d, yyyy")}
                  </span>
                }
                {flag.resolved_by &&
                <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    Resolved by {flag.resolved_by}
                  </span>
                }
              </div>
            </div>
          </div>
          {!flag.is_resolved &&
          <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setShowResolve(true)} className="text-emerald-700 border-emerald-300 hover:bg-emerald-50">
                <CheckCircle2 className="w-4 h-4 mr-1" /> Resolve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(flag.id)} className="text-slate-400 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          }
        </div>

        {showResolve &&
        <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
            <Label>Resolution Notes</Label>
            <Textarea
            placeholder="Describe how the issue was resolved..."
            value={resolveNotes}
            onChange={(e) => setResolveNotes(e.target.value)}
            rows={2} />
          
            <div className="flex gap-2">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => {onResolve(flag.id, resolveNotes);setShowResolve(false);}}>
                Confirm Resolution
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowResolve(false)}>Cancel</Button>
            </div>
          </div>
        }
      </CardContent>
    </Card>);

}

function SupportUploadTab() {
  const queryClient = useQueryClient();
  const [uploadStatus, setUploadStatus] = useState(null);
  const [manualForm, setManualForm] = useState({ site_id: "", interaction_date: "", interaction_type: "", case_number: "", salesforce_case_id: "", description: "" });

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });

  // Find the most recent upload_batch timestamp from existing records
  const { data: lastUploadInfo } = useQuery({
    queryKey: ["lastSupportUpload"],
    queryFn: async () => {
      const recent = await listLocalCollection("supportInteractions");
      if (!recent.length) return null;
      return { date: recent[0].created_date, by: recent[0].uploaded_by };
    }
  });

  const createMutation = useMutation({
    mutationFn: (data) => createLocalRecord("supportInteractions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supportInteractions"] });
      setManualForm({ site_id: "", interaction_date: "", interaction_type: "", case_number: "", salesforce_case_id: "", description: "" });
      setUploadStatus({ type: "success", message: "Support interaction logged successfully." });
    }
  });

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[\s"]/g, ""));
    return lines.slice(1).map((line) => {
      // Handle quoted fields with commas inside
      const cols = [];
      let cur = "",inQ = false;
      for (const ch of line) {
        if (ch === '"') {inQ = !inQ;} else
        if (ch === "," && !inQ) {cols.push(cur.trim());cur = "";} else
        {cur += ch;}
      }
      cols.push(cur.trim());
      const row = {};
      headers.forEach((h, i) => {row[h] = (cols[i] || "").replace(/^"|"$/g, "").trim();});
      return row;
    });
  };

  const normalizeDate = (val) => {
    if (!val) return null;
    // Already ISO
    if (val.includes("T")) return val;
    // YYYY-MM-DD or YYYY-MM-DD HH:MM:SS
    if (val.match(/^\d{4}-\d{2}-\d{2}/)) return val.replace(" ", "T") + (val.length === 10 ? "T00:00:00.000Z" : ".000Z");
    // M/D/YYYY or M/D/YYYY H:MM
    const mdy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)/);
    if (mdy) {
      const [, m, d, y, rest] = mdy;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}${rest ? "T" + rest.trim() : "T00:00:00.000Z"}`;
    }
    return val;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setUploadStatus({ type: "loading", message: "Reading file..." });
    try {
      const text = await file.text();
      const rows = parseCSV(text);

      if (!rows.length) {
        setUploadStatus({ type: "error", message: "No rows found in file. Make sure it is a valid CSV with headers." });
        return;
      }

      const detectedHeaders = Object.keys(rows[0]);

      const siteIdKey = detectedHeaders.find((h) => h.includes("siteid") || h.includes("site_id") || h === "site");
      const dateKey = detectedHeaders.find((h) => h.includes("interactiondate") || h.includes("interaction_date") || h.includes("date"));

      if (!siteIdKey || !dateKey) {
        setUploadStatus({ type: "error", message: `Could not find required columns. Detected headers: [${detectedHeaders.join(", ")}]. Need columns containing "site_id" and "interaction_date".` });
        return;
      }

      // Load existing interactions to deduplicate
      setUploadStatus({ type: "loading", message: "Checking for duplicates..." });
      const existing = await listLocalCollection("supportInteractions");
      // Build a dedupe key set: site_id + case_number + date (YYYY-MM-DD)
      const existingKeys = new Set(existing.map((r) => {
        const dateStr = r.interaction_date ? r.interaction_date.slice(0, 10) : "";
        return `${r.site_id}|${r.case_number || ""}|${dateStr}`;
      }));

      const batchId = `upload_${Date.now()}`;
      let created = 0,skipped = 0,duplicates = 0;

      for (const row of rows) {
        const siteId = row[siteIdKey]?.trim();
        const rawDate = row[dateKey]?.trim();
        if (!siteId || !rawDate) {skipped++;continue;}

        const dateVal = normalizeDate(rawDate);
        const caseNum = row["casenumber"] || row["case_number"] || row["case"] || "";
        const dateStr = dateVal ? dateVal.slice(0, 10) : "";
        const dedupeKey = `${siteId}|${caseNum}|${dateStr}`;

        if (existingKeys.has(dedupeKey)) {duplicates++;continue;}
        existingKeys.add(dedupeKey); // prevent dupes within same upload

        await createLocalRecord("supportInteractions", {
          site_id: siteId,
          interaction_date: dateVal,
          interaction_type: row["interactiontype"] || row["interaction_type"] || row["type"] || "",
          case_number: caseNum,
          salesforce_case_id: row["salesforcecaseid"] || row["salesforce_case_id"] || row["sfid"] || row["sf_id"] || "",
          description: row["description"] || row["notes"] || row["summary"] || "",
          upload_batch: batchId,
          uploaded_by: currentUser?.email || ""
        });
        created++;
      }

      queryClient.invalidateQueries({ queryKey: ["supportInteractions"] });
      queryClient.invalidateQueries({ queryKey: ["lastSupportUpload"] });
      const parts = [`Successfully imported ${created} new interactions.`];
      if (duplicates > 0) parts.push(`${duplicates} duplicate(s) skipped.`);
      if (skipped > 0) parts.push(`${skipped} row(s) missing required fields.`);
      setUploadStatus({ type: "success", message: parts.join(" ") });
    } catch (err) {
      setUploadStatus({ type: "error", message: `Error: ${err.message}` });
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({ ...manualForm, uploaded_by: currentUser?.email || "", upload_batch: `manual_${Date.now()}` });
  };

  return (
    <div className="space-y-6">
      {/* File Upload */}
      <Card className="border-indigo-200 bg-indigo-50/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-indigo-900">
            <Upload className="w-5 h-5" /> Import Support Interactions (.csv / .xlsx)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lastUploadInfo ?
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-indigo-100 text-sm text-slate-600">
              <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                Last upload: <strong>{new Date(lastUploadInfo.date).toLocaleString("en-US", { timeZone: "America/Boise", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</strong>
                {lastUploadInfo.by && <span className="text-slate-400"> by {lastUploadInfo.by}</span>}
              </span>
            </div> :

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-indigo-100 text-sm text-slate-400">
              <Clock className="w-4 h-4 shrink-0" />
              <span>No data uploaded yet</span>
            </div>
          }
          <p className="text-sm text-slate-600">
            Export your support report and upload it here. Required columns: <code className="bg-white px-1 rounded text-xs">site_id</code>, <code className="bg-white px-1 rounded text-xs">interaction_date</code>. Optional: <code className="bg-white px-1 rounded text-xs">interaction_type</code>, <code className="bg-white px-1 rounded text-xs">case_number</code>, <code className="bg-white px-1 rounded text-xs">description</code>.
          </p>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-100 file:text-indigo-700 file:font-medium hover:file:bg-indigo-200 cursor-pointer" />
          {uploadStatus &&
          <div className={cn("text-sm px-4 py-3 rounded-lg font-medium", {
            "bg-emerald-50 text-emerald-800": uploadStatus.type === "success",
            "bg-red-50 text-red-800": uploadStatus.type === "error",
            "bg-blue-50 text-blue-800": uploadStatus.type === "loading"
          })}>
              {uploadStatus.message}
            </div>
          }
        </CardContent>
      </Card>

      {/* Manual Entry */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-5 h-5" /> Log Single Interaction Manually
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleManualSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Site ID <span className="text-red-500">*</span></Label>
              <Input placeholder="e.g. 12345" value={manualForm.site_id} onChange={(e) => setManualForm({ ...manualForm, site_id: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Interaction Date <span className="text-red-500">*</span></Label>
              <Input type="datetime-local" value={manualForm.interaction_date} onChange={(e) => setManualForm({ ...manualForm, interaction_date: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Input placeholder="e.g. Call, Ticket, Escalation" value={manualForm.interaction_type} onChange={(e) => setManualForm({ ...manualForm, interaction_type: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Case Number</Label>
              <Input placeholder="e.g. CS-12345" value={manualForm.case_number} onChange={(e) => setManualForm({ ...manualForm, case_number: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Salesforce Case ID <span className="text-slate-400 text-xs">(optional, for direct link)</span></Label>
              <Input placeholder="e.g. 500Ps00001QxAf0IAF" value={manualForm.salesforce_case_id} onChange={(e) => setManualForm({ ...manualForm, salesforce_case_id: e.target.value })} />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label>Description</Label>
              <Textarea placeholder="Brief summary of the interaction..." value={manualForm.description} onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })} rows={2} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Log Interaction"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>);

}

function SiteFlagManagerContent() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("flags");
  const [filterLevel, setFilterLevel] = useState("all");
  const [filterResolved, setFilterResolved] = useState("active");
  const [syncing, setSyncing] = useState(false);

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });
  const { data: flags = [], isLoading: flagsLoading } = useQuery({ queryKey: ["siteFlags"], queryFn: () => listLocalCollection("siteFlags") });
  const { data: svRecords = [] } = useQuery({ queryKey: ["svCancelTracker"], queryFn: () => listLocalCollection("svCancels") });
  const { data: interactions = [] } = useQuery({ queryKey: ["supportInteractions"], queryFn: () => listLocalCollection("supportInteractions"), staleTime: 60_000 });

  const resolveMutation = useMutation({
    mutationFn: ({ id, notes }) => updateLocalRecord("siteFlags", id, {
      is_resolved: true,
      resolved_by: currentUser?.email || "",
      resolved_date: new Date().toISOString(),
      resolved_notes: notes
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["siteFlags"] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteLocalRecord("siteFlags", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["siteFlags"] })
  });

  const syncFlags = async () => {
    setSyncing(true);
    // Yield to browser before heavy computation
    await new Promise((r) => setTimeout(r, 0));
    try {
      // --- Truckroll flags from SVCancelTracker ---
      // Group by site_id, sum cancel_counts
      const truckrollBySite = {};
      for (const rec of svRecords) {
        if (!rec.site_id) continue;
        if (!truckrollBySite[rec.site_id]) truckrollBySite[rec.site_id] = { count: 0, latest: null };
        truckrollBySite[rec.site_id].count += rec.cancel_count || 1;
        const d = rec.created_date ? new Date(rec.created_date) : null;
        if (d && (!truckrollBySite[rec.site_id].latest || d > truckrollBySite[rec.site_id].latest)) {
          truckrollBySite[rec.site_id].latest = d;
        }
      }

      // --- Support contact flags from SupportInteraction (rolling 10 days) ---
      const tenDaysAgo = subDays(new Date(), 10);
      const supportBySite = {};
      for (const interaction of interactions) {
        if (!interaction.site_id || !interaction.interaction_date) continue;
        const d = parseISO(interaction.interaction_date);
        if (!isAfter(d, tenDaysAgo)) continue;
        if (!supportBySite[interaction.site_id]) supportBySite[interaction.site_id] = { count: 0, dates: [], latest: null };
        supportBySite[interaction.site_id].count++;
        supportBySite[interaction.site_id].dates.push(d);
        if (!supportBySite[interaction.site_id].latest || d > supportBySite[interaction.site_id].latest) {
          supportBySite[interaction.site_id].latest = d;
        }
      }

      // Check for same-day multiple calls (triggers red)
      const supportRedSites = new Set();
      for (const [siteId, data] of Object.entries(supportBySite)) {
        const dayMap = {};
        for (const d of data.dates) {
          const key = format(d, "yyyy-MM-dd");
          dayMap[key] = (dayMap[key] || 0) + 1;
        }
        if (Object.values(dayMap).some((c) => c >= 2)) supportRedSites.add(siteId);
      }

      // All site IDs that need flagging
      const allSiteIds = new Set([
      ...Object.keys(truckrollBySite).filter((s) => (truckrollBySite[s].count || 0) >= 2),
      ...Object.keys(supportBySite).filter((s) => (supportBySite[s].count || 0) >= 2)]
      );

      for (const siteId of allSiteIds) {
        const tc = truckrollBySite[siteId]?.count || 0;
        let sc = supportBySite[siteId]?.count || 0;
        // Force red if same-day multiple calls
        const isSupportRed = supportRedSites.has(siteId);

        let supportLevel = null;
        if (isSupportRed || sc >= 4) supportLevel = "red";else
        if (sc >= 3) supportLevel = "orange";else
        if (sc >= 2) supportLevel = "yellow";

        let truckrollLevel = null;
        if (tc >= 4) truckrollLevel = "red";else
        if (tc >= 3) truckrollLevel = "orange";else
        if (tc >= 2) truckrollLevel = "yellow";

        const levelOrder = ["yellow", "orange", "red"];
        const flagLevel = [supportLevel, truckrollLevel].
        filter(Boolean).
        sort((a, b) => levelOrder.indexOf(b) - levelOrder.indexOf(a))[0];

        if (!flagLevel) continue;

        const flagSource = tc >= 2 && sc >= 2 ? "both" : tc >= 2 ? "truckroll" : "support_contacts";

        // Find existing non-resolved flag for this site
        const existing = flags.find((f) => f.site_id === siteId && !f.is_resolved);

        const payload = {
          site_id: siteId,
          flag_level: flagLevel,
          flag_source: flagSource,
          truckroll_count: tc,
          support_contact_count: sc,
          last_truckroll_date: truckrollBySite[siteId]?.latest?.toISOString() || null,
          last_support_date: supportBySite[siteId]?.latest?.toISOString() || null
        };

        if (existing) {
          await updateLocalRecord("siteFlags", existing.id, payload);
        } else {
          await createLocalRecord("siteFlags", payload);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["siteFlags"] });
    } finally {
      setSyncing(false);
    }
  };

  const displayedFlags = flags.filter((f) => {
    if (filterResolved === "active" && f.is_resolved) return false;
    if (filterResolved === "resolved" && !f.is_resolved) return false;
    if (filterLevel !== "all" && f.flag_level !== filterLevel) return false;
    return true;
  });

  const activeCount = flags.filter((f) => !f.is_resolved).length;
  const redCount = flags.filter((f) => !f.is_resolved && f.flag_level === "red").length;
  const orangeCount = flags.filter((f) => !f.is_resolved && f.flag_level === "orange").length;
  const yellowCount = flags.filter((f) => !f.is_resolved && f.flag_level === "yellow").length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <Siren className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Site Flag Manager</h1>
            <p className="text-sm text-slate-500">Truckroll &amp; support escalation monitoring</p>
          </div>
        </div>
        <Button onClick={syncFlags} disabled={syncing} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
          {syncing ? "Syncing..." : "Sync Flags Now"}
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-slate-500 mb-1">Active Flags</p>
            <p className="text-2xl font-bold text-slate-900">{activeCount}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-red-500 mb-1">Critical (Red)</p>
            <p className="text-2xl font-bold text-red-700">{redCount}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-orange-500 mb-1">Level 2 (Orange)</p>
            <p className="text-2xl font-bold text-orange-700">{orangeCount}</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-yellow-600 mb-1">Level 1 (Yellow)</p>
            <p className="text-2xl font-bold text-yellow-700">{yellowCount}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="flags">Active Flags</TabsTrigger>
          <TabsTrigger value="quote-trouble">Quote Trouble Tracker</TabsTrigger>
        </TabsList>

        <TabsContent value="flags" className="space-y-4 mt-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <Filter className="w-4 h-4 text-slate-400" />
            <Select value={filterLevel} onValueChange={setFilterLevel}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="red">Critical (Red)</SelectItem>
                <SelectItem value="orange">Level 2 (Orange)</SelectItem>
                <SelectItem value="yellow">Level 1 (Yellow)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterResolved} onValueChange={setFilterResolved}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active Only</SelectItem>
                <SelectItem value="resolved">Resolved Only</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {flagsLoading ?
          <div className="text-center py-10 text-slate-400">Loading flags...</div> :
          displayedFlags.length === 0 ?
          <Card className="p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <p className="font-semibold text-slate-700">No flags found</p>
              <p className="text-sm text-slate-500 mt-1">Click "Sync Flags Now" to evaluate current data.</p>
            </Card> :

          <div className="space-y-3">
              {displayedFlags.map((flag) =>
            <FlagCard
              key={flag.id}
              flag={flag}
              onResolve={(id, notes) => resolveMutation.mutate({ id, notes })}
              onDelete={(id) => deleteMutation.mutate(id)} />

            )}
            </div>
          }
        </TabsContent>

        <TabsContent value="quote-trouble" className="mt-4">
          {tab === "quote-trouble" && <SiteQuoteTracker />}
        </TabsContent>

        <TabsContent value="upload" className="mt-4">
          <SupportUploadTab />
        </TabsContent>

        <TabsContent value="interactions" className="mt-4">
          {tab === "interactions" && <SupportInteractionsLog />}
        </TabsContent>
      </Tabs>
    </div>);

}

function SupportInteractionsLog() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  const { data: interactions = [], isLoading } = useQuery({
    queryKey: ["supportInteractionsLog"],
    queryFn: () => listLocalCollection("supportInteractions"),
    staleTime: 60_000
  });

  // Build a count of how many times each site_id appears
  const siteRepeatCounts = interactions.reduce((acc, i) => {
    if (i.site_id) acc[i.site_id] = (acc[i.site_id] || 0) + 1;
    return acc;
  }, {});

  const lowerSearch = search.toLowerCase();
  const filtered = search ?
  interactions.filter((i) =>
  i.site_id?.toLowerCase().includes(lowerSearch) || i.case_number?.toLowerCase().includes(lowerSearch)
  ) :
  interactions;

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input placeholder="Search by Site ID or Case #..." value={search} onChange={(e) => {setSearch(e.target.value);setPage(1);}} className="max-w-sm" />
        {!isLoading && <span className="text-sm text-slate-400">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>}
      </div>
      <Card>
        <CardContent className="p-0">
          {isLoading ?
          <div className="p-10 text-center text-slate-400">Loading interactions...</div> :
          filtered.length === 0 ?
          <div className="p-10 text-center text-slate-400">No support interactions logged yet.</div> :

          <div className="divide-y divide-slate-100">
              {paginated.map((interaction) => {
              const repeatCount = siteRepeatCounts[interaction.site_id] || 1;
              const sfUrl = interaction.salesforce_case_id ?
              `https://enphase.lightning.force.com/lightning/r/Case/${interaction.salesforce_case_id}/view` :
              null;
              const enlightenUrl = interaction.site_id ?
              `https://enlighten.enphaseenergy.com/admin/sites/${interaction.site_id}` :
              null;

              return (
                <div key={interaction.id} className="px-5 py-3 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Site ID</p>
                      {enlightenUrl ?
                    <a href={enlightenUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline">
                          {interaction.site_id}
                        </a> :

                    <p className="font-semibold text-slate-900">{interaction.site_id}</p>
                    }
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Date</p>
                      <p className="text-slate-700">{(() => {try {const d = parseISO(interaction.interaction_date);return isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");} catch {return "—";}})()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Type</p>
                      <p className="text-slate-700">{interaction.interaction_type || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Case #</p>
                      {sfUrl ?
                    <a href={sfUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800 hover:underline">
                          {interaction.case_number || "—"}
                        </a> :

                    <p className="text-slate-700">{interaction.case_number || "—"}</p>
                    }
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Repeat Contacts</p>
                      <span className={cn(
                      "inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold",
                      repeatCount >= 4 ? "bg-red-100 text-red-700" :
                      repeatCount >= 3 ? "bg-orange-100 text-orange-700" :
                      repeatCount >= 2 ? "bg-yellow-100 text-yellow-700" :
                      "bg-slate-100 text-slate-600"
                    )}>
                        {repeatCount}×
                      </span>
                    </div>
                  </div>);

            })}
            </div>
          }
        </CardContent>
      </Card>
      {totalPages > 1 &&
      <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
          </div>
        </div>
      }
      <p className="text-xs text-slate-400">* Repeat Contacts shows how many total interactions exist for that site across all uploaded data.</p>
    </div>);

}

export default function SiteFlagManager() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <SiteFlagManagerContent />
    </RoleGuard>);

}