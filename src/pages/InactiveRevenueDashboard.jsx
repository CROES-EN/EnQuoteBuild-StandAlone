import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {format, subDays} from "date-fns";
import {Card} from "@/components/ui/card";
import RoleGuard from "@/components/auth/RoleGuard";
import DateRangeFilters from "@/components/inactive-dashboard/DateRangeFilters";
import OverviewMetrics from "@/components/inactive-dashboard/OverviewMetrics";
import DecisionReasons from "@/components/inactive-dashboard/DecisionReasons";
import {getInactiveSummary} from "@/components/inactive-dashboard/inactiveRevenueService";
import InactiveDataError from "@/components/inactive-dashboard/InactiveDataError";

function InactiveRevenueDashboardContent() {
  const [preset, setPreset] = useState("Last 30 Days");
  const [range, setRange] = useState(() => {
    const now = new Date();
    return {start: format(subDays(now, 30), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd")};
  });
  const validRange = Boolean(range.start && range.end && range.start <= range.end);
  const {data, isPending, isError, error, refetch, isFetching} = useQuery({
    queryKey: ["inactive-dashboard", range.start, range.end],
    queryFn: () => getInactiveSummary(range),
    enabled: validRange
  });
  const filters = <Card className="border-border p-4"><DateRangeFilters range={range} setRange={setRange} preset={preset} setPreset={setPreset} /></Card>;
  if (!validRange) return <div className="mx-auto max-w-7xl space-y-6 p-6">{filters}<p role="alert" className="text-destructive">Select a valid start and end date. Start must not be after end.</p></div>;
  if (isError) return <>{filters}<InactiveDataError error={error} refetch={refetch} isFetching={isFetching} /></>;
  if (isPending || !data) return <div className="mx-auto max-w-7xl space-y-6 p-6">{filters}<div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" /></div></div>;
  const resolvedRange = data.range;
  const dates = `start=${resolvedRange.start}&end=${resolvedRange.end}`;
  const labels = {rejection_reviews: "Rejection Reviews", site_flags: "Site Flags", deletion_requests: "Deletion Requests", rmas: "PV Panel RMAs", material_orders: "Material Orders"};
  const metrics = [
    {label: "Boneyard", count: data.boneyard.count, value: data.boneyard.revenue, to: `/Boneyard?${dates}`},
    ...Object.entries(labels).map(([category, label]) => ({
      label, count: data.collections[category], to: `/InactiveCollections?category=${category}&${dates}`
    }))
  ];
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div><h1 className="text-3xl font-bold text-foreground">Inactive Revenue Dashboard</h1><p className="mt-1 text-muted-foreground">Monitor inactive quotes, homeowner decisions, and related operational queues.</p></div>
      {filters}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-warning/40 bg-warning/10 p-5"><p className="text-sm font-medium text-foreground">Inactive quotes</p><p className="mt-1 text-3xl font-bold text-foreground">{data.inactive.count}</p></Card>
        <Card className="border-warning/40 bg-warning/10 p-5"><p className="text-sm font-medium text-foreground">Inactive revenue</p><p className="mt-1 text-3xl font-bold text-foreground">${data.inactive.revenue.toLocaleString(undefined, {maximumFractionDigits: 0})}</p></Card>
      </div>
      <OverviewMetrics metrics={metrics} />
      <DecisionReasons reasons={data.decision_reasons} range={resolvedRange} />
    </div>
  );
}

export default function InactiveRevenueDashboard() { return <RoleGuard><InactiveRevenueDashboardContent /></RoleGuard>; }
