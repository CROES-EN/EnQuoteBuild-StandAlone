import {useQuery} from "@tanstack/react-query";
import {Link, useLocation} from "react-router-dom";
import {Card} from "@/components/ui/card";
import RoleGuard from "@/components/auth/RoleGuard";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";
import {getInactiveDrilldown} from "@/components/inactive-dashboard/inactiveRevenueService";
import InactiveDataError from "@/components/inactive-dashboard/InactiveDataError";

const labels = { rejection_reviews: "Rejection Reviews", site_flags: "Site Flags", deletion_requests: "Deletion Requests", rmas: "PV Panel RMAs", material_orders: "Material Orders", homeowner_decisions: "Homeowner Decisions" };

function InactiveCollectionsContent() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const category = params.get("category");
  const start = params.get("start") || "0001-01-01";
  const end = params.get("end") || "9999-12-31";
  const reason = params.get("reason");
  const {data, isPending, isError, error, refetch, isFetching} = useQuery({
    queryKey: ["inactive-collection", category, start, end, reason],
    queryFn: () => getInactiveDrilldown({start, end, category, reason})
  });
  if (isError) return <InactiveDataError error={error} refetch={refetch} isFetching={isFetching} />;
  if (isPending || !data) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-indigo-600" /></div>;
  const records = data;
  const title = reason ? `${labels[category]}: ${reason.replace(/_/g, " ")}` : labels[category] || "Inactive Collection";
  return <div className="mx-auto max-w-6xl space-y-6 p-6"><div><Link to="/InactiveRevenueDashboard" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">← Inactive Revenue Dashboard</Link><h1 className="mt-2 text-3xl font-bold text-foreground">{title}</h1><p className="mt-1 text-muted-foreground">{records.length} records from {start} through {end}</p></div><div className="space-y-3">{records.map((record) => { const quote = category === "homeowner_decisions" ? record : null; const detail = quote ? (quote.ho_rejection_reason || quote.hold_reason || "No feedback entered") : (record.notes || record.reason || record.description || record.admin_notes || record.current_status || record.status || "No details entered"); const name = quote ? (quote.site_id ? <SiteIdLink siteId={quote.site_id} className="font-semibold" /> : quote.quote_number) : record.site_id ? <SiteIdLink siteId={record.site_id} className="font-semibold" /> : record.case_id ? <CaseNumberLink caseNumber={record.case_id} className="font-semibold" /> : (record.quote_number || record.item_name || record.name || "Record"); return <Card key={record.id} className="border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-foreground">{name}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>{quote && <Link to={`/QuoteDetails?id=${quote.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">View quote</Link>}</div></Card>; })}</div>{records.length === 0 && <Card className="border-border p-10 text-center text-muted-foreground">No matching records in this date range.</Card>}</div>;
}

export default function InactiveCollections() { return <RoleGuard><InactiveCollectionsContent /></RoleGuard>; }