import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, X, CheckCheck } from "lucide-react";

export default function BulkActionBar({
  selectedCount,
  statusOptions,
  bulkStatus,
  onBulkStatusChange,
  onApply,
  onClear,
  isPending,
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-4 z-30 mx-auto max-w-2xl">
      <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900 text-white shadow-2xl border border-slate-700">
        <span className="text-sm font-semibold px-2 whitespace-nowrap">
          {selectedCount} selected
        </span>
        <Select value={bulkStatus} onValueChange={onBulkStatusChange}>
          <SelectTrigger className="w-52 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder="Set status to..." />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={onApply}
          disabled={!bulkStatus || isPending}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <CheckCheck className="w-4 h-4 mr-1" />
          )}
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          className="text-slate-300 hover:text-white hover:bg-slate-800 ml-auto"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}