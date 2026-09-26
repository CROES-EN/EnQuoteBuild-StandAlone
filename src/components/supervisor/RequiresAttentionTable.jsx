import {AlertTriangle} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";

// Neutral labels only, per spec - no criticality/urgency implied without an approved threshold.
const REASON_BADGE_CLASS = {
  "Review Recommended": "border-amber-200 bg-amber-50 text-amber-700",
  "Partial Coverage": "border-border bg-secondary text-muted-foreground",
  "Source Missing": "border-border bg-secondary text-muted-foreground",
  "Current Period": "border-indigo-200 bg-indigo-50 text-indigo-700",
  "No Threshold Configured": "border-border bg-secondary text-muted-foreground",
  "Import Review Required": "border-amber-200 bg-amber-50 text-amber-700",
  "Data Incomplete": "border-border bg-secondary text-muted-foreground"
};

/**
 * Objective, threshold-free summary of the selected period per the O&M reporting spec's
 * "Requires Attention" section - every row is a fact about the period (a backlog moved, a source
 * is missing, N snapshots are absent), never an invented severity ranking. Rows are supplied
 * fully-formed by the caller (DashboardOverview.jsx), which already has the period aggregates
 * and source-coverage results this table only needs to display.
 */
export default function RequiresAttentionTable({ rows = [] }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Requires Attention
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing flagged for this reporting period.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Period Value</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium text-foreground">{row.area}</TableCell>
                  <TableCell>{row.periodValue ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.change ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.coverage ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={REASON_BADGE_CLASS[row.reason] || "border-border text-muted-foreground"}>
                      {row.reason}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.source ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={!row.onViewRecords} onClick={row.onViewRecords}>
                      View Records
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
