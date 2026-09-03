import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RoleGuard from "@/components/auth/RoleGuard";
import ImportReportDialog from "@/components/supervisor/ImportReportDialog";
import DailyMetricsForm from "@/components/supervisor/DailyMetricsForm";
import ContactCenterPanel from "@/components/supervisor/ContactCenterPanel";
import StaffingPanel from "@/components/supervisor/StaffingPanel";
import QuoteOperationsPanel from "@/components/supervisor/QuoteOperationsPanel";
import CaseBacklogPanel from "@/components/supervisor/CaseBacklogPanel";
import EnphaseCarePanel from "@/components/supervisor/EnphaseCarePanel";
import EscalationsPanel from "@/components/supervisor/EscalationsPanel";
import DailySnapshotReport from "@/components/supervisor/DailySnapshotReport";
import DashboardOverview from "@/components/supervisor/DashboardOverview";
import ReportsInboxCard from "@/components/supervisor/ReportsInboxCard";
import ReportInventory from "@/components/supervisor/ReportInventory";
import ImportCenter from "@/components/supervisor/ImportCenter";
import { listDailyMetrics, isElectronBacked } from "@/features/supervisorDashboard/opsMetricsStore";
import { getPriorBusinessDate } from "@/features/supervisorDashboard/omSnapshotCalculations";
import { DEFAULT_COMPLETED_STATUSES } from "@/features/supervisorDashboard/quoteOpsMetrics";
import { getLastImportedFile, canOpenLocalFiles, openLastImportedFile } from "@/features/supervisorDashboard/lastImportedFile";
import { toast } from "sonner";
import {
  Upload, Plus, HardDrive, Info, Gauge, Phone, Users, ClipboardList,
  HeartHandshake, TriangleAlert, BookMarked, CalendarDays, FileText, NotebookText, FileSpreadsheet, FolderInput
} from "lucide-react";

const QUERY_KEY = ["supervisor-daily-metrics"];

function SupervisorDashboardContent() {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [importInitialSource, setImportInitialSource] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [completedStatuses, setCompletedStatuses] = useState(DEFAULT_COMPLETED_STATUSES);
  const [lastImportedFile, setLastImportedFileState] = useState(() => getLastImportedFile());
  // Keyed by date so the Daily Snapshot Report tab's Executive Summary edits survive Radix Tabs
  // unmounting that panel when the user switches to a different tab and back (that field has no
  // Save button of its own, unlike every other form in this feature).
  const [summaryDraftsByDate, setSummaryDraftsByDate] = useState({});

  const { data: records = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listDailyMetrics
  });

  // One shared "which day am I looking at" selection drives every tab below (Contact Center,
  // Staffing, Quote Operations, Case Backlog, Enphase Care, Escalations, and the Daily Snapshot
  // Report all read/write or compute against this same date) - defaults to the most recent
  // recorded day once data loads, or the prior business day (per the O&M Snapshot spec's
  // default reporting window) if there's no data yet at all, instead of leaving every panel
  // blank with nothing to select.
  useEffect(() => {
    // Wait for the query to actually settle before deciding - `records` is `[]` (its useQuery
    // default) for the entire loading window, so deciding eagerly here would always take the
    // "no data yet" branch on a cold load and never reach "most recent recorded day" below, even
    // when real data exists once the fetch finishes.
    if (selectedDate || isLoading) return;
    if (records.length) {
      setSelectedDate(records[records.length - 1].date);
    } else {
      setSelectedDate(getPriorBusinessDate());
    }
  }, [records, selectedDate, isLoading]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    setLastImportedFileState(getLastImportedFile());
  }

  function openAddForm() {
    setEditingRecord(null);
    setFormOpen(true);
  }

  function openImportForReport(reportTypeId) {
    setImportInitialSource(reportTypeId);
    setImportOpen(true);
  }

  function openEditForm(record) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  async function handleOpenLastImportedFile() {
    const result = await openLastImportedFile();
    if (!result?.ok) {
      toast.error(result?.error || "Couldn't open that file - it may have moved or been renamed.");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supervisor Dashboard</h1>
          <p className="text-slate-500 mt-1">
            Prior-day O&amp;M operations snapshot — contact center, quotes, staffing, backlog, Care, and
            escalations — imported from CXONE/Salesforce/Incorta reports, or entered manually.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openAddForm}>
            <Plus className="mr-2 w-4 h-4" />
            Add Day Manually
          </Button>
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 w-4 h-4" />
            Import Report
          </Button>
          {lastImportedFile && canOpenLocalFiles() && (
            <Button
              variant="outline"
              onClick={handleOpenLastImportedFile}
              title={`Open ${lastImportedFile.name}${lastImportedFile.path ? ` (${lastImportedFile.path})` : ""}`}
            >
              <FileSpreadsheet className="mr-2 w-4 h-4" />
              Open {lastImportedFile.name}
            </Button>
          )}
        </div>
      </div>

      {!isElectronBacked() && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              Running outside the desktop app - this data is stored in this browser only and won't be shared with
              other devices. Use the EnQuote desktop app so imports are saved to the shared local data file.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 bg-slate-50">
        <CardContent className="p-4 flex items-start gap-3">
          <HardDrive className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600">
            This dashboard is fully independent of Base44 — it never reads or writes Base44/quote data. All metrics
            here live in their own local store on this PC.
          </p>
        </CardContent>
      </Card>

      <ReportsInboxCard />

      <div className="flex items-center gap-3">
        <Label htmlFor="supervisor-viewing-day" className="flex items-center gap-1.5 text-sm text-slate-500 whitespace-nowrap">
          <CalendarDays className="w-4 h-4" /> Viewing day:
        </Label>
        <Input
          id="supervisor-viewing-day"
          type="date"
          className="w-48"
          value={selectedDate || ""}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
        <p className="text-xs text-slate-400">Every tab below reads and saves this same day's record.</p>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="dashboard" className="flex items-center gap-1.5"><Gauge className="w-4 h-4" /> Executive Overview</TabsTrigger>
          <TabsTrigger value="import-center" className="flex items-center gap-1.5"><FolderInput className="w-4 h-4" /> Import Center</TabsTrigger>
          <TabsTrigger value="contact-center" className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> Contact Center</TabsTrigger>
          <TabsTrigger value="staffing" className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Staffing</TabsTrigger>
          <TabsTrigger value="quote-ops" className="flex items-center gap-1.5"><FileText className="w-4 h-4" /> Quote Operations</TabsTrigger>
          <TabsTrigger value="backlog" className="flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> Case Backlog</TabsTrigger>
          <TabsTrigger value="care" className="flex items-center gap-1.5"><HeartHandshake className="w-4 h-4" /> Enphase Care</TabsTrigger>
          <TabsTrigger value="escalations" className="flex items-center gap-1.5"><TriangleAlert className="w-4 h-4" /> Escalations</TabsTrigger>
          <TabsTrigger value="snapshot-report" className="flex items-center gap-1.5"><NotebookText className="w-4 h-4" /> Daily Snapshot Report</TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-1.5"><BookMarked className="w-4 h-4" /> Report Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardOverview
            records={records}
            selectedDate={selectedDate}
            completedStatuses={completedStatuses}
            onEditRecord={openEditForm}
            onChanged={refresh}
          />
        </TabsContent>

        <TabsContent value="import-center" className="mt-4">
          <ImportCenter records={records} onRequestImport={openImportForReport} />
        </TabsContent>

        <TabsContent value="contact-center" className="mt-4">
          <ContactCenterPanel records={records} selectedDate={selectedDate} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="staffing" className="mt-4">
          <StaffingPanel records={records} selectedDate={selectedDate} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="quote-ops" className="mt-4">
          <QuoteOperationsPanel
            records={records}
            selectedDate={selectedDate}
            onChanged={refresh}
            completedStatuses={completedStatuses}
            onCompletedStatusesChange={setCompletedStatuses}
          />
        </TabsContent>

        <TabsContent value="backlog" className="mt-4">
          <CaseBacklogPanel records={records} selectedDate={selectedDate} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="care" className="mt-4">
          <EnphaseCarePanel records={records} selectedDate={selectedDate} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="escalations" className="mt-4">
          <EscalationsPanel records={records} selectedDate={selectedDate} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="snapshot-report" className="mt-4">
          <DailySnapshotReport
            records={records}
            selectedDate={selectedDate}
            completedStatuses={completedStatuses}
            summaryText={summaryDraftsByDate[selectedDate]}
            onSummaryTextChange={(text) => setSummaryDraftsByDate(prev => ({ ...prev, [selectedDate]: text }))}
          />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <ReportInventory />
        </TabsContent>
      </Tabs>

      <ImportReportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refresh} initialSource={importInitialSource} />
      <DailyMetricsForm open={formOpen} onOpenChange={setFormOpen} editingRecord={editingRecord} onSaved={refresh} />
    </div>
  );
}

export default function SupervisorDashboard() {
  return (
    <RoleGuard allowedRoles={["admin", "approver"]}>
      <SupervisorDashboardContent />
    </RoleGuard>
  );
}

