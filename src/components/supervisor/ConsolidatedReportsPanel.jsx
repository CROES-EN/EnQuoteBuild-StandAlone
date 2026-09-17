import { useState } from "react";
import { Table2, Settings as SettingsIcon } from "lucide-react";
import AutoImportSettingsPanel from "@/components/supervisor/AutoImportSettingsPanel";
import ReportDataTablesPanel from "@/components/supervisor/ReportDataTablesPanel";

/**
 * "Report Data" - consolidated home for every report this Supervisor Dashboard can
 * import, per the user's request to merge the former separate "Import Center" and
 * "Report Data" tabs into one neatly organized tab (both existed to serve the same
 * underlying purpose - getting outside report data into EnQuote).
 *
 * This is intentionally a thin wrapper, NOT a rewrite:
 *   - "Case Report Tables" (default view) renders the existing ReportDataTablesPanel
 *     as-is - row-level imports (Escalations, Audits, Care-Cases, O&M-CS-Cases,
 *     Incorta-O&M-Input, SFDC-Quotes, Care Subscriptions) that never touch KPI data.
 *   - "Daily Metrics Import" renders the existing ImportCenter as-is - daily
 *     AGGREGATE imports (Contact Center, Staffing, Salesforce, O&M Case Backlog,
 *     Enphase Care, Escalations) that feed the Executive Overview KPI tiles via
 *     opsMetricsStore.js.
 * Both existing components, dialogs, and import pipelines are reused unchanged -
 * this file only changes navigation, never import/parsing/aggregation behavior.
 */
export default function ConsolidatedReportsPanel({ records, onRequestImport }) {
  const [mode, setMode] = useState("tables");

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary p-1">
        <button
          type="button"
          onClick={() => setMode("tables")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
            mode === "tables" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Table2 className="h-3.5 w-3.5" /> Case Report Tables
        </button>
        <button
          type="button"
          onClick={() => setMode("daily")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
            mode === "daily" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <SettingsIcon className="h-3.5 w-3.5" /> Settings
        </button>
      </div>

      {mode === "tables" ? (
        <ReportDataTablesPanel />
      ) : (
        <AutoImportSettingsPanel />
      )}
    </div>
  );
}