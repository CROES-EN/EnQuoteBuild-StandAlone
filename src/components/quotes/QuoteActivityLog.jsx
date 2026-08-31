import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getQuoteActivities } from "@/api/dataClient";
import { Card } from "@/components/ui/card";
import { Clock } from "lucide-react";

export default function QuoteActivityLog({ quoteId }) {
  const { data: activities = [] } = useQuery({
    queryKey: ["quoteActivity", quoteId],
    queryFn: async () => (await getQuoteActivities(quoteId)).sort((a, b) => String(b.action_at || "").localeCompare(String(a.action_at || ""))).slice(0, 100),
    enabled: !!quoteId,
  });

  return (
    <Card className="p-6 mt-6 border-slate-200">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Activity Log</h3>
      {activities.length ? <div className="space-y-4">
        {activities.map(activity => <div key={activity.id} className="flex gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
          <Clock className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">Quote {activity.action}{activity.changed_fields?.length ? `: ${activity.changed_fields.join(", ")}` : ""}</p>
            <p className="text-xs text-slate-500 mt-1">{activity.mountain_time}{activity.performed_by ? ` · ${activity.performed_by}` : ""}</p>
          </div>
        </div>)}
      </div> : <p className="text-sm text-slate-500">No activity has been logged yet.</p>}
    </Card>
  );
}