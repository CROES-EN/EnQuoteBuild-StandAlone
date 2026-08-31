import { base44 } from "@/api/base44Client";
import { getQuotes } from "@/api/dataClient";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Clock, FileText, ArchiveRestore } from "lucide-react";
import StatusBadge from "./StatusBadge";

export default function QuoteVersionHistory({ quote, canRestore = false, onRestore }) {
  const parentQuoteId = quote?.parent_quote_id || quote?.id;
  
  const { data: versions = [], isLoading } = useQuery({
    enabled: !!parentQuoteId,
    queryKey: ["quote-versions", parentQuoteId],
    queryFn: async () => {
      const allQuotes = await getQuotes();
      const allVersions = allQuotes.filter(q => q.id === parentQuoteId || q.parent_quote_id === parentQuoteId);
      return allVersions.sort((a, b) => (b.version_number || 1) - (a.version_number || 1));
    }
  });

  if (!quote) return null;

  if (isLoading) {
    return (
      <Card className="p-6 border-slate-200">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </Card>
    );
  }

  if (versions.length <= 1) {
    return null;
  }

  return (
    <Card className="p-6 border-slate-200">
      <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5" />
        Version History
      </h3>
      <div className="space-y-3">
        {versions.map((version) => {
          const isCurrent = version.is_current_version !== false;
          return (
            <div key={version.id} className="relative">
              <Link
                to={createPageUrl(`QuoteDetails?id=${version.id}`)}
                className={`block p-4 rounded-lg border transition-all ${
                  isCurrent 
                    ? "bg-indigo-50 border-indigo-200" 
                    : "bg-white border-slate-200 hover:bg-slate-50"
                } ${canRestore && !isCurrent ? "pr-28" : ""}`}
              >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isCurrent ? "bg-indigo-600" : "bg-slate-100"
                  }`}>
                    <FileText className={`w-5 h-5 ${isCurrent ? "text-white" : "text-slate-600"}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className={`font-semibold ${isCurrent ? "text-indigo-900" : "text-slate-900"}`}>
                        Version {version.version_number || 1}
                      </p>
                      {isCurrent && (
                        <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs font-medium rounded-full">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">
                      {format(new Date(version.created_date), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={version.status} size="sm" />
                  <p className="text-lg font-semibold text-slate-900">
                    ${(version.total || 0).toFixed(2)}
                  </p>
                </div>
              </div>
              </Link>
              {canRestore && !isCurrent && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRestore(version)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                >
                  <ArchiveRestore className="w-4 h-4 mr-1.5" />
                  Restore
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}