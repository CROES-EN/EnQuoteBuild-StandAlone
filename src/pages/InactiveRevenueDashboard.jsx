import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { getQuotes, getReviews, listLocalCollection } from "@/api/dataClient";
import { Card } from "@/components/ui/card";
import RoleGuard from "@/components/auth/RoleGuard";
import DateRangeFilters from "@/components/inactive-dashboard/DateRangeFilters";
import OverviewMetrics from "@/components/inactive-dashboard/OverviewMetrics";
import DecisionReasons from "@/components/inactive-dashboard/DecisionReasons";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const inRange = (item, range, dateField = "created_date") => { const date = item[dateField] || item.updated_date || item.created_date; return date && date.slice(0, 10) >= range.start && date.slice(0, 10) <= range.end; };
const decisionKey = quote => { const text = `${quote.hold_reason || ""} ${quote.ho_rejection_reason || ""}`.toLowerCase(); if (text.includes("no_customer_response") || text.includes("no customer response") || text.includes("no response")) return "no_customer_response"; if (text.includes("cost") || text.includes("price") || text.includes("financ")) return "cost"; if (text.includes("schedul")) return "scheduling"; if (text.includes("homeowner_cancelled") || text.includes("cancel")) return "homeowner_cancelled"; if (text.includes("homeowner_declined") || text.includes("declin")) return "homeowner_declined"; return "other"; };

function InactiveRevenueDashboardContent() {
  const [preset, setPreset] = useState("Last 30 Days");
  const [range, setRange] = useState({ start: daysAgo(30), end: today });
  const { data, isLoading } = useQuery({ queryKey: ["inactive-dashboard"], queryFn: async () => { const [quotes, reviews, flags, deletions, rmas, orders] = await Promise.all([getQuotes(), getReviews(), listLocalCollection("siteFlags"), listLocalCollection("deletionRequests"), listLocalCollection("rmas"), listLocalCollection("materialOrders")]); return { quotes, reviews, flags, deletions, rmas, orders }; } });
  if (isLoading) return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" /></div>;
  const quotes = (data?.quotes || []).filter(q => q.is_current_version !== false);
  const boneyard = quotes.filter(q => q.status === "on_hold" && inRange(q, range, "hold_date"));
  const inactiveQuotes = quotes.filter(q => ["on_hold", "ho_rejected", "rejected"].includes(q.status) && inRange(q, range, q.status === "on_hold" ? "hold_date" : "ho_rejected_date"));
  const inactiveRevenue = inactiveQuotes.reduce((sum, quote) => sum + (quote.total || 0), 0);
  const dates = `start=${range.start}&end=${range.end}`;
  const metrics = [{ label: "Boneyard", count: boneyard.length, value: boneyard.reduce((sum, q) => sum + (q.total || 0), 0), to: `/Boneyard?${dates}` }, { label: "Rejection Reviews", count: data.reviews.filter(x => inRange(x, range)).length, to: `/InactiveCollections?category=rejection_reviews&${dates}` }, { label: "Site Flags", count: data.flags.filter(x => inRange(x, range)).length, to: `/InactiveCollections?category=site_flags&${dates}` }, { label: "Deletion Requests", count: data.deletions.filter(x => inRange(x, range)).length, to: `/InactiveCollections?category=deletion_requests&${dates}` }, { label: "PV Panel RMAs", count: data.rmas.filter(x => inRange(x, range)).length, to: `/InactiveCollections?category=rmas&${dates}` }, { label: "Material Orders", count: data.orders.filter(x => inRange(x, range)).length, to: `/InactiveCollections?category=material_orders&${dates}` }];
  const reasons = inactiveQuotes.reduce((all, quote) => ({ ...all, [decisionKey(quote)]: (all[decisionKey(quote)] || 0) + 1 }), {});
  return <div className="mx-auto max-w-7xl space-y-6 p-6"><div><h1 className="text-3xl font-bold text-slate-900">Inactive Revenue Dashboard</h1><p className="mt-1 text-slate-600">Monitor inactive quotes, homeowner decisions, and related operational queues.</p></div><Card className="border-slate-200 p-4"><DateRangeFilters range={range} setRange={setRange} preset={preset} setPreset={setPreset} /></Card><div className="grid gap-4 md:grid-cols-2"><Card className="border-amber-200 bg-amber-50 p-5"><p className="text-sm font-medium text-amber-800">Inactive quotes</p><p className="mt-1 text-3xl font-bold text-amber-950">{inactiveQuotes.length}</p></Card><Card className="border-amber-200 bg-amber-50 p-5"><p className="text-sm font-medium text-amber-800">Inactive revenue</p><p className="mt-1 text-3xl font-bold text-amber-950">${inactiveRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></Card></div><OverviewMetrics metrics={metrics} /><DecisionReasons reasons={reasons} range={range} /></div>;
}
export default function InactiveRevenueDashboard() { return <RoleGuard allowedRoles={["admin", "approver", "invoicer"]}><InactiveRevenueDashboardContent /></RoleGuard>; }