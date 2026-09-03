import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteDailyMetric } from "@/features/supervisorDashboard/opsMetricsStore";
import { formatSecondsAsClock, formatDateLabel, formatNumber } from "@/features/supervisorDashboard/format";

const SOURCE_LABELS = {
  cxone: "CXONE",
  nice_wfm: "NICE WFM",
  salesforce: "Salesforce",
  incorta: "Incorta",
  care_tracker: "Care Tracker",
  escalations_tracker: "Escalations Tracker",
  other: "Other",
  manual: "Manual"
};

export default function MetricsHistoryTable({ records, onEdit, onChanged }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteDailyMetric(pendingDelete.id);
      toast.success(`Deleted metrics for ${pendingDelete.date}`);
      onChanged?.();
    } catch (err) {
      toast.error(err.message || "Could not delete this record.");
    }
    setPendingDelete(null);
  }

  return (
    <>
      <div className="border rounded-lg overflow-auto max-h-[28rem]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Calls</TableHead>
              <TableHead>AHT</TableHead>
              <TableHead>Emails Worked</TableHead>
              <TableHead>Quotes Drafted</TableHead>
              <TableHead>Staffing</TableHead>
              <TableHead>Sources</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(record => (
              <TableRow key={record.id || record.date}>
                <TableCell className="font-medium whitespace-nowrap">{formatDateLabel(record.date)}</TableCell>
                <TableCell>{formatNumber(record.calls)}</TableCell>
                <TableCell>{formatSecondsAsClock(record.aht_seconds)}</TableCell>
                <TableCell>{formatNumber(record.emails_worked)}</TableCell>
                <TableCell>{formatNumber(record.quotes_drafted)}</TableCell>
                <TableCell>{formatNumber(record.staffing_present)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(record.sources || {}).map(src => (
                      <Badge key={src} variant="outline" className="text-[10px] py-0 px-1.5 text-slate-500 border-slate-200">
                        {SOURCE_LABELS[src] || src}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(record)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setPendingDelete(record)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-slate-400 py-8">No daily metrics recorded yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(next) => !next && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete metrics for {pendingDelete?.date}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every metric recorded for this day (calls, AHT, emails, quotes, staffing). This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
