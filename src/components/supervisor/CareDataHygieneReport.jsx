import {useMemo, useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {AlertTriangle, CheckCircle2, RefreshCcw, ShieldAlert, Users} from "lucide-react";
import {computeCareDataHygieneSummary} from "@/features/supervisorDashboard/careEligibility";

/**
 * Data Hygiene view for the imported Care Subscriptions report - shows exactly how many rows
 * are real vs. excluded (and why), how many unique homeowners/Site IDs exist, how many have a
 * renewal history, and which real records are missing a Site ID and need manual follow-up.
 *
 * This is deliberately NOT a sales dashboard - no revenue totals, no rep breakdowns. Its only
 * purpose is to make the underlying eligibility data trustworthy and auditable before it is
 * ever used to waive travel/labor charges via the Quote Form badge (a later step).
 *
 * All counts here are computed by the exact same careEligibility.js functions that the
 * eligibility lookup itself will use, so this report can never show different numbers than
 * what the real lookup returns for any given Site ID.
 *
 * Records with no Enlighten Site Id are labeled "SunPower Site - Verify by Address" rather than
 * a generic "missing data" message, per user confirmation that a real Care customer with no
 * Site ID on file is almost always a SunPower-monitored system (which does not always sync an
 * Enlighten Site ID the same way Enphase-native systems do), not a data-entry error.
 */
export default function CareDataHygieneReport({ table }) {
  const [showExcluded, setShowExcluded] = useState(false);
  const [showMissingSiteId, setShowMissingSiteId] = useState(false);

  const summary = useMemo(
    () => computeCareDataHygieneSummary(table?.rows || []),
    [table]
  );

  if (!table) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-muted-foreground">
        No Care Subscriptions data imported yet. Use "Import This Report" to load the Care Subscription Dashboard export.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-border bg-secondary p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rows Imported</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.totalRowsImported}</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Real Records</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.realRecordCount}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowExcluded(true)}
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-left transition-colors hover:bg-amber-100"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Excluded (Test/Internal)</p>
          <p className="mt-1 text-2xl font-bold text-amber-800">{summary.excludedCount}</p>
        </button>
        <div className="rounded-xl border border-border bg-secondary p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unique Site IDs</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.uniqueSiteIdCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary p-3">
          <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <RefreshCcw className="h-3 w-3" /> Renewed Sites
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.renewalSiteCount}</p>
        </div>
        {summary.missingSiteIdRecords.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowMissingSiteId(true)}
            className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-left transition-colors hover:bg-sky-100"
          >
            <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-sky-700">
              <ShieldAlert className="h-3 w-3" /> SunPower Sites
            </p>
            <p className="mt-1 text-2xl font-bold text-sky-800">{summary.missingSiteIdRecords.length}</p>
          </button>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> SunPower Sites
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-800">0</p>
          </div>
        )}
      </div>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Current Status (most recent record per Site ID)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              ACTIVE: {summary.statusBreakdown.ACTIVE}
            </Badge>
            <Badge variant="outline" className="border-border bg-secondary text-muted-foreground">
              EXPIRED: {summary.statusBreakdown.EXPIRED}
            </Badge>
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
              CANCELLED: {summary.statusBreakdown.CANCELLED}
            </Badge>
            {summary.statusBreakdown.OTHER > 0 && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                OTHER: {summary.statusBreakdown.OTHER}
              </Badge>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            "Current" means the most recent record (by Created Dt) for that Site ID. Sites with
            more than one real record ({summary.renewalSiteCount} of them) have a renewal
            history - every prior record is preserved, not discarded, and can be reviewed on the
            main Care Subscriptions list.
          </p>
        </CardContent>
      </Card>

      {Object.keys(summary.exclusionReasonCounts).length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Exclusion Reasons
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.exclusionReasonCounts).map(([reason, count]) => (
                <Badge key={reason} variant="outline" className="border-border bg-secondary text-muted-foreground">
                  {reason}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showExcluded} onOpenChange={setShowExcluded}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Excluded Test / Internal Records</DialogTitle>
          </DialogHeader>
          <p className="mb-2 text-xs text-muted-foreground">
            These rows are excluded from Care eligibility checks and never counted toward
            Active/Expired/Cancelled totals or renewal history.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason Excluded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.excludedRecords.map((item, i) => (
                <TableRow key={i}>
                  <TableCell>{item.row["Customer First Name"]} {item.row["Customer Last Name"]}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={item.row["Customer Email"]}>
                    {item.row["Customer Email"] || "None"}
                  </TableCell>
                  <TableCell>{item.row["Subscription Status"] || "None"}</TableCell>
                  <TableCell className="text-amber-700">{item.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={showMissingSiteId} onOpenChange={setShowMissingSiteId}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-sky-500" /> SunPower Sites - Verify by Address
            </DialogTitle>
          </DialogHeader>
          <p className="mb-2 text-xs text-muted-foreground">
            These are real (non-excluded) Care subscriptions with no Enlighten Site Id on file -
            typically SunPower-monitored systems, which do not always sync a Site ID the same
            way Enphase-native systems do. Match these to a site manually using the customer's
            address rather than by Site ID.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.missingSiteIdRecords.map((row, i) => (
                <TableRow key={i}>
                  <TableCell>{row["Customer First Name"]} {row["Customer Last Name"]}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={row["Customer Address"]}>
                    {row["Customer Address"] || "None"}
                  </TableCell>
                  <TableCell>{row["Subscription Status"] || "None"}</TableCell>
                  <TableCell>{row["Created Dt"] || "None"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}

