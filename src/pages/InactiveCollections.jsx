import { useQuery } from "@tanstack/react-query";
import { Link, useLocation} from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { getReviews, listLocalCollection } from "@/api/dataClient";
import { Card } from "@/components/ui/card";
import RoleGuard from "@/components/auth/RoleGuard";

const labels = { rejection_reviews: "Rejection Reviews", site_flags: "Site Flags", deletion_requests: "Deletion Requests", rmas: "PV Panel RMAs", material_orders: "Material Orders", homeowner_decisions: "Homeowner Decisions" };
const inRange = (item, start, end, field = "created_date") => { const value = item[field] || item.updated_date || item.created_date; return value && value.slice(0, 10) >= start && value.slice(0, 10) <= end; };
const reasonKey = (quote) => { const text = `${quote.hold_reason || ""} ${quote.ho_rejection_reason || ""}`.toLowerCase(); if (text.includes("no_customer_response") || text.includes("no customer response") || text.includes("no response")) return "no_customer_response"; if (text.includes("cost") || text.includes("price") || text.includes("financ")) return "cost"; if (text.includes("schedul")) return "scheduling"; if (text.includes("homeowner_cancelled") || text.includes("cancel")) return "homeowner_cancelled"; if (text.includes("homeowner_declined") || text.includes("declin")) return "homeowner_declined"; return "other"; };

function InactiveCollectionsContent() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const category = params.get("category");
  const start = params.get("start") || "0000-01-01";
  const end = params.get("end") || "9999-12-31";
  const reason = params.get("reason");
  const { data, isLoading } = useQuery({ queryKey: ["inactive-collection", category], queryFn: async () => {
    const [quotes, reviews, flags, deletions, rmas, orders] = await Promise.all([getQuotes(), getReviews(), listLocalCollection("siteFlags"), listLocalCollection("deletionRequests"), listLocalCollection("rmas"), listLocalCollection("materialOrders")]);
    return { quotes, reviews, flags, deletions, rmas, orders };
  }});
  if (isLoading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" /></div>;
  const sources = { rejection_reviews: data.reviews, site_flags: data.flags, deletion_requests: data.deletions, rmas: data.rmas, material_orders: data.orders };
  let records = sources[category] || [];
  if (category === "homeowner_decisions") records = data.quotes.filter((quote) => ["on_hold", "ho_rejected", "rejected"].includes(quote.status) && inRange(quote, start, end, quote.status === "on_hold" ? "hold_date" : "ho_rejected_date") && (!reason || reasonKey(quote) === reason));
  else records = records.filter((record) => inRange(record, start, end));
  const title = reason ? `${labels[category]}: ${reason.replace(/_/g, " ")}` : labels[category] || "Inactive Collection";
  return <div className="mx-auto max-w-6xl space-y-6 p-6"><div><Link to="/InactiveRevenueDashboard" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">â† Inactive Revenue Dashboard</Link><h1 className="mt-2 text-3xl font-bold text-slate-900">{title}</h1><p className="mt-1 text-slate-600">{records.length} records from {start} through {end}</p></div><div className="space-y-3">{records.map((record) => { const quote = category === "homeowner_decisions" ? record : null; const name = quote ? (quote.site_id || quote.quote_number) : (record.site_id || record.case_id || record.quote_number || record.item_name || record.name || "Record"); const detail = quote ? (quote.ho_rejection_reason || quote.hold_reason || "No feedback entered") : (record.notes || record.reason || record.description || record.admin_notes || record.current_status || record.status || "No details entered"); return <Card key={record.id} className="border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{name}</p><p className="mt-1 text-sm text-slate-600">{detail}</p></div>{quote && <Link to={`/QuoteDetails?id=${quote.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">View quote</Link>}</div></Card>; })}</div>{records.length === 0 && <Card className="border-slate-200 p-10 text-center text-slate-500">No matching records in this date range.</Card>}</div>;
}

export default function InactiveCollections() { return <RoleGuard allowedRoles={["admin", "approver", "invoicer"]}><InactiveCollectionsContent /></RoleGuard>; }