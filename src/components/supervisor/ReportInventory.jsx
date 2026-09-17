import { useState } from "react";
import { ExternalLink, BookMarked, Table2, ListChecks, ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

/**
 * Read-only reference content for the Supervisor Dashboard, derived directly from the
 * "O&M Daily Operations Snapshot - Master AI Prompt and Report Inventory" document
 * (prepared September 2, 2026). This panel never reads, imports, or modifies any of the
 * spreadsheets/dashboards it references - it only tells a supervisor where to go get each
 * number and which system is authoritative when two reports could answer the same question.
 */

const SOURCE_OF_TRUTH_MAP = [
  { need: "Contact-center results", source: "Incorta EODB Dashboard", measures: "Calls, AHT, wait time, abandoned calls, Email Queue" },
  { need: "O&M case and appointment data", source: "Incorta O&M Scheduling Dashboard", measures: "Backlog, FST totals, appointment status, Cannot Complete" },
  { need: "New quote demand", source: "Salesforce Quote Request Cases with Case Comments", measures: "Quotes received and intake details" },
  { need: "Quote production", source: "EnQuote Quote and QuoteActivity", measures: "Quotes drafted, completed, aging, lifecycle" },
  { need: "Staffing and absences", source: "NICE CXone Workforce Management", measures: "Scheduled staff, absences, availability, productive hours" },
  { need: "Data quality and owner actions", source: "O&M-Case-Tracker-v2.xlsx", measures: "Exceptions, notes, missing picklists, missing EnQuote records" },
  { need: "Escalations", source: "O&M escalation tracker / Tracker V2", measures: "Severity, owner, blocker, next action, overdue follow-up" },
  { need: "Care plan cancellations", source: "EnQuote SVCancelTracker", measures: "Cancellation requests and completion" },
  { need: "Operational blockers", source: "O&M Case Tracking Report / Travel Plan Tracker", measures: "Cannot Complete reasons, travel constraints, discussion items" }
];

const REPORT_INVENTORY = [
  {
    name: "1. EODB Dashboard - Pronto/ISR Team",
    platform: "Incorta",
    status: "Confirmed primary source",
    link: "https://enphase-1.cloud2.incorta.com/incorta/!enphase/#/dashboard/3f49ad7f-2ed3-46e6-a91e-c201a592d2d9/tab/8aa4d1fb-84c4-4a99-b073-dcf1f198b318",
    useFor: ["Calls offered or total call volume", "Calls handled", "Calls abandoned, if displayed", "Average handle time", "Average wait time, if displayed", "Email Queue volume", "Emails received and worked/completed", "Email backlog, if displayed", "Queue or team productivity"],
    rule: "Treat this as the primary source for contact-center results. Under Email Queue, prefer Completed, Closed, or Resolved over raw outbound messages. Confirm the queue, team, date, and timezone filters."
  },
  {
    name: "2. O&M Scheduling Dashboard",
    platform: "Incorta",
    status: "Confirmed primary source",
    link: "https://enphase-1.cloud2.incorta.com/incorta/!enphase/#/dashboard/eb5129c3-c29f-4eb6-81ab-acda2fc012b3/tab/c060b40d-e934-428d-9ebe-4f9fde5b73cf",
    useFor: ["O&M case backlog", "Backlog by team, Project Picklist, and O&M Status", "FST service appointment totals", "Canceled appointments", "Cannot Complete totals and reasons", "Scheduling volume and work type", "Case data reconciliation"],
    rule: "Prefer this dashboard to an Excel duplicate when both contain the same case or appointment metric. It receives Salesforce data through the established reporting integration."
  },
  {
    name: "3. Quote Request Cases with Case Comments",
    platform: "Salesforce",
    status: "Confirmed primary source",
    link: "https://enphase.lightning.force.com/lightning/r/Report/00OPs000007cj89MAA/view?queryScope=userFolders",
    useFor: ["New quote intake", "Quotes received by prior day", "Quote category", "Submitting technician or comment creator", "Case number and Enlighten Site ID", "Requests not yet matched to EnQuote"],
    rule: "Count distinct Case Number where the standardized Case Comment contains Quote Request and Case Comment Created Date falls within the prior-day window. Preserve the CSV export only as an input artifact, not as a second source."
  },
  {
    name: "4. O&M-Case-Tracker-v2.xlsx",
    platform: "Excel / SharePoint",
    status: "Confirmed supporting report - view/import only",
    link: "https://enphase.sharepoint.com/:x:/r/sites/fst/Shared%20Documents/O%26M%20docs/O%26M-Case-Tracker-v2.xlsx",
    useFor: ["Backlog by team and work type", "Quote-status backlog", "Pending Schedule and Pending RMA", "Waiting on Customer or Installer", "Unresponsive Customer", "Missing Project Picklist", "Quotes not found in EnQuote", "Owner notes and action management"],
    rule: "Use for data-quality validation, action ownership, notes, and temporary snapshots. Do not override matching Incorta measures without documenting why."
  },
  {
    name: "5. O&M Case Tracking Report.xlsx",
    platform: "Excel / OneDrive",
    status: "Confirmed supporting report - view/import only",
    link: "https://enphase-my.sharepoint.com/:x:/g/personal/croeschberger_enphaseenergy_com/IQBiCSolkZ5ISJUDLTbVKVD1AeWxVmziyHUiGiK8DGMEXSc",
    useFor: ["Current O&M and quote backlog", "Quote Requested, Draft, Missing Details, Pending Materials, Pending Approval, Pending Payment", "Care and On-Demand appointment cancellations", "Cannot Complete reasons", "Case ownership and aging", "O&M Feed Back discussion points and blockers"],
    rule: "Known tabs include Pivot Table, Full O&M Report, O&M FST Service Appointments, O&M Feed Back, and Quote Estimator. Use as a validation and blocker source when Incorta is primary."
  },
  {
    name: "6. O&M Tracker (desktop only).xlsm",
    platform: "Excel desktop with macros",
    status: "Confirmed supporting report - view/import only",
    link: null,
    useFor: ["New and open escalations", "Escalation owner, type, and status", "Received and completed timestamps", "Cycle time", "Permit and travel-related escalations", "Escalation notes"],
    rule: "Open in Excel desktop, allow macros, and do not manually edit generated timestamps. Locate by the exact filename in the O&M SharePoint/Teams files."
  },
  {
    name: "7. O&M Escalation Workflow & SOP.docx",
    platform: "Word / SharePoint",
    status: "Confirmed process definition",
    link: null,
    useFor: ["Escalation qualification rules", "S1 Critical, S2 High, S3 Standard", "Required root cause and blocker", "Next action, owner, and follow-up date", "Leadership involvement and closure rules"],
    rule: "This document defines what qualifies for the escalation report. The current O&M tracker remains the system of record until an approved Salesforce escalation field is implemented."
  },
  {
    name: "8. EnQuote Quote and QuoteActivity data",
    platform: "EnQuote / Base44 data",
    status: "Confirmed operational dataset - no report URL",
    link: null,
    useFor: ["Quotes drafted", "Quotes completed", "Quote state changes", "Pending review, approval, or payment", "Creator/owner", "Turnaround time", "Salesforce intake reconciliation"],
    rule: "Use the .CSV export from the Quotes page within EnQuote/Base44 - not a live connection. Use lifecycle event timestamps, not current status alone. Agree on the exact business event that means completed."
  },
  {
    name: "9. Travel plan Tracker.xlsx",
    platform: "Excel / SharePoint",
    status: "Confirmed supporting report - view/import only",
    link: null,
    useFor: ["Pending travel plans", "Travel assignments", "Approvals", "Work week and work type", "Field coverage constraints", "Travel-related blockers"],
    rule: "Include only when travel affects O&M capacity or a significant customer case."
  },
  {
    name: "11. O&M Scheduling Summary (Outlook email)",
    platform: "Outlook email with tracker attachment",
    status: "Confirmed historical snapshot",
    link: null,
    useFor: ["Published backlog snapshot", "Team and work-type totals", "Quote status breakdown", "Data hygiene exceptions", "Quotes missing from EnQuote"],
    rule: "Useful as a validation point and as the structural model for the automated daily message. Report link not confirmed - search by exact file/report name."
  },
  {
    name: "12. O&M Backlog, Aging & Data Hygiene Summary",
    platform: "Outlook email with tracker attachment",
    status: "Confirmed weekly health report",
    link: null,
    useFor: ["Open cases by team/project", "P50 and P95 case age", "P50 and P95 days since modified", "External-action backlog", "Data-hygiene issues"],
    rule: "Best suited to a weekly health section rather than the core daily production scorecard. Report link not confirmed - search by exact file/report name."
  }
];

const CXONE_REPORTS_TO_LOCATE = {
  intro: "NICE CXone data arrives through a manual CSV export - never a direct connection. Export the applicable CSV from NICE CXone and import it below (or upload it to an AI assistant) for each reporting period. Before processing, validate the filename, reporting date, reporting window, queue/team filters, column headers, and export timestamp.",
  workforce: ["Published Schedule or Agent Schedule", "Schedule Summary", "Intraday Staffing", "Time-Off or Activity Summary", "Schedule Adherence", "Staffing by Interval", "Agent State or Agent Activity"],
  workforceTarget: "Target measures: team headcount, scheduled staff, available staff, full-day absences, partial-day absences, meetings/training, productive scheduled hours, actual productive hours, and adherence if requested.",
  queue: ["Contact Summary", "Skill or Queue Performance", "Inbound Contact Performance", "Abandon Analysis", "Service Level", "Contact History", "Digital or Email Contact Summary"],
  queueTarget: "Target measures only if missing from EODB: offered, handled, abandoned, short abandons, average speed of answer, average wait, service level, and granular email contact measures."
};

const METRIC_DEFINITIONS = [
  { metric: "Calls Offered", definition: "Total inbound contacts presented to the selected O&M queue during the reporting window." },
  { metric: "Calls Handled", definition: "Contacts answered and handled by the selected queue during the reporting window." },
  { metric: "Calls Abandoned", definition: "Inbound contacts disconnected before being handled, using the dashboard definition. Report short abandons separately if available." },
  { metric: "Average Handle Time", definition: "Use the EODB dashboard definition and display as hh:mm:ss or mm:ss." },
  { metric: "Average Wait Time", definition: "Use queue wait or average speed of answer only after confirming the dashboard label. Do not silently substitute one for the other." },
  { metric: "Emails Worked", definition: "Prefer completed, closed, or resolved email contacts. If only handled is available, label it Emails Handled. Do not use raw sent-message count unless explicitly approved." },
  { metric: "Quotes Received", definition: "Distinct Salesforce Case Number with a qualifying Quote Request case comment created during the prior-day window." },
  { metric: "Quotes Drafted", definition: "Distinct EnQuote Quote ID first created or first transitioned into Quote Draft during the prior-day window." },
  { metric: "Quotes Completed", definition: "Distinct EnQuote Quote ID transitioned into the agreed operational completion state during the prior-day window." },
  { metric: "Team Headcount", definition: "Active employees assigned to the O&M team, regardless of daily availability." },
  { metric: "Available Staffing", definition: "Scheduled staffing minus full-day absence, plus an explicit adjustment for partial-day time away when hours are available." },
  { metric: "Backlog at Start / End", definition: "Count of qualifying open records captured by immutable scheduled snapshots. Do not reconstruct a start count from a current live report unless event history supports it." },
  { metric: "Care Appointment Cancellations", definition: "Canceled Enphase Care field-service appointments." },
  { metric: "Care Plan Cancellations", definition: "Care plan or service cancellation requests in SVCancelTracker. Keep separate from appointments." },
  { metric: "Major Blocker", definition: "An issue affecting multiple cases, queue capacity, revenue, safety, legal/regulatory exposure, or a leadership-dependent decision." },
  { metric: "Escalation", definition: "A record meeting the O&M Escalation Workflow & SOP criteria. Report severity, owner, current blocker, next action, and due date." }
];

const CHECKLIST_ITEMS = [
  "Confirm reporting timezone and business-day boundaries.",
  "Confirm the exact O&M call queue, email queue, and workforce team filters.",
  "Confirm what EnQuote event/status means Quotes Completed.",
  "Confirm whether Emails Worked means completed, resolved, or handled.",
  "Confirm the exact NICE CXone workforce report name and access permissions.",
  "Confirm snapshot capture times for beginning and ending backlog.",
  "Confirm whether Care Refunds are stored in EnQuote, Salesforce, or another approved tracker.",
  "Confirm who supplies and approves manual blockers and escalations.",
  "Record refresh cadence for Incorta, Salesforce, EnQuote, CXone, and Excel sources.",
  "Test one known prior day against manually validated totals before publishing automatically."
];

const CHECKLIST_STORAGE_KEY = "enquote_supervisor_report_inventory_checklist_v1";

function readChecklistState() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(CHECKLIST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function StatusBadge({ status }) {
  const isPrimary = status.toLowerCase().includes("primary");
  const isViewOnly = status.toLowerCase().includes("view/import only");
  return (
    <Badge
      variant="outline"
      className={
        isPrimary ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : isViewOnly ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-border bg-secondary text-muted-foreground"
      }
    >
      {status}
    </Badge>
  );
}

export default function ReportInventory() {
  const [checklist, setChecklist] = useState(() => readChecklistState());

  function toggleChecklistItem(index) {
    setChecklist(prev => {
      const next = { ...prev, [index]: !prev[index] };
      try {
        globalThis.window?.localStorage?.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort only - checklist still works for this session even if it can't persist.
      }
      return next;
    });
  }

  const checkedCount = Object.values(checklist).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <Card className="border-border bg-secondary">
        <CardContent className="p-4 flex items-start gap-3">
          <BookMarked className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Reference only - nothing on this tab imports, edits, or connects to any of these systems. It tells you
            which report is authoritative for each metric and where to find it. Spreadsheets marked{" "}
            <span className="font-medium text-amber-700">view/import only</span> should never be edited in place -
            import a copy into the Daily Metrics tab, don't save changes back to the shared file.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Table2 className="w-4 h-4 text-indigo-600" />
            Quick Source-of-Truth Map
          </CardTitle>
          <p className="text-xs text-muted-foreground">Use this hierarchy to prevent overlapping reports from producing conflicting totals.</p>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Need</TableHead>
                  <TableHead>Primary Source</TableHead>
                  <TableHead>Measures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SOURCE_OF_TRUTH_MAP.map(row => (
                  <TableRow key={row.need}>
                    <TableCell className="font-medium whitespace-nowrap">{row.need}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.source}</TableCell>
                    <TableCell className="text-muted-foreground">{row.measures}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-indigo-600" />
            Complete Report Inventory
          </CardTitle>
          <p className="text-xs text-muted-foreground">Direct links are included where confirmed. Where none was surfaced, locate the exact filename rather than guessing a URL.</p>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            {REPORT_INVENTORY.map(report => (
              <AccordionItem key={report.name} value={report.name}>
                <AccordionTrigger className="text-sm">
                  <div className="flex flex-1 flex-wrap items-center justify-between gap-2 pr-2">
                    <span className="text-left font-medium text-foreground">{report.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-muted-foreground border-border">{report.platform}</Badge>
                      <StatusBadge status={report.status} />
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 text-sm">
                    {report.link && (
                      <a
                        href={report.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-indigo-600 hover:underline"
                      >
                        Open report <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Use for</p>
                      <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                        {report.useFor.map(item => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Reporting rule</p>
                      <p className="text-muted-foreground">{report.rule}</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-indigo-600" />
            NICE CXone Reports to Locate for Confirmed Gaps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">{CXONE_REPORTS_TO_LOCATE.intro}</p>
          <div>
            <p className="font-medium text-foreground mb-1">CXone Workforce Management</p>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {CXONE_REPORTS_TO_LOCATE.workforce.map(item => (
                <Badge key={item} variant="outline" className="text-muted-foreground border-border font-normal">{item}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{CXONE_REPORTS_TO_LOCATE.workforceTarget}</p>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">CXone Queue and Contact Reporting</p>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {CXONE_REPORTS_TO_LOCATE.queue.map(item => (
                <Badge key={item} variant="outline" className="text-muted-foreground border-border font-normal">{item}</Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{CXONE_REPORTS_TO_LOCATE.queueTarget}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Table2 className="w-4 h-4 text-indigo-600" />
            Required Metric Definitions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-56">Metric</TableHead>
                  <TableHead>Required Definition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {METRIC_DEFINITIONS.map(row => (
                  <TableRow key={row.metric}>
                    <TableCell className="font-medium whitespace-nowrap align-top">{row.metric}</TableCell>
                    <TableCell className="text-muted-foreground">{row.definition}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-indigo-600" />
            Configuration Checklist Before Production Use
          </CardTitle>
          <p className="text-xs text-muted-foreground">{checkedCount} of {CHECKLIST_ITEMS.length} confirmed - saved on this PC only.</p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {CHECKLIST_ITEMS.map((item, index) => (
            <label key={item} className="flex items-start gap-2.5 text-sm cursor-pointer">
              <Checkbox
                checked={Boolean(checklist[index])}
                onCheckedChange={() => toggleChecklistItem(index)}
                className="mt-0.5"
              />
              <span className={checklist[index] ? "text-muted-foreground line-through" : "text-foreground"}>{item}</span>
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
