import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { getQuotes, listLocalCollection } from "@/api/dataClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  FileText, 
  CheckCircle, 
  XCircle,
  TrendingUp,
  Filter,
  FolderOpen,
  FolderCheck
} from "lucide-react";
import MetricCard from "@/components/dashboard/MetricCard";
import StatusChart from "@/components/dashboard/StatusChart";
import TrendChart from "@/components/dashboard/TrendChart";
import SLAMetrics from "@/components/dashboard/SLAMetrics";
import CoordinatorPerformance from "@/components/dashboard/CoordinatorPerformance";
import StatusAlerts from "@/components/dashboard/StatusAlerts";
import SiteFlagBanner from "@/components/flags/SiteFlagBanner";
import CoachingFeedback from "@/components/dashboard/CoachingFeedback";

import RoleGuard from "@/components/auth/RoleGuard";
import { parseISO } from "date-fns";
import { createPageUrl } from "@/utils";

function DashboardContent() {
  const [statusFilter, setStatusFilter] = useState("all");
  const { user: currentUser } = useAuth();
  const [coordinatorFilter, setCoordinatorFilter] = useState("all");
  const isLocalDemo = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);

  const { data: allQuotes = [], isLoading } = useQuery({
  queryKey: ["quotes"],
  queryFn: async () => {
    const quotes = await getQuotes();

    return quotes.filter(
      q =>
        q.is_current_version !== false &&
        !q.exclude_from_reporting
    );
  }
});

  const { data: siteFlags = [] } = useQuery({
    queryKey: ["siteFlags"],
    queryFn: () => listLocalCollection("siteFlags"),
  });

  // Get unique coordinators
  const coordinators = [...new Set(allQuotes.map(q => q.created_by).filter(Boolean))];

  // Filter quotes based on selections
  const filteredQuotes = allQuotes.filter(quote => {
    if (statusFilter !== "all" && quote.status !== statusFilter) return false;
    if (coordinatorFilter !== "all" && quote.created_by !== coordinatorFilter) return false;
    return true;
  });

  // Calculate key metrics
  const totalQuotes = filteredQuotes.length;
  const submittedQuotes = filteredQuotes.filter(q => q.status !== 'draft').length;
  const approvedQuotes = filteredQuotes.filter(q => 
    q.status === 'approved' || q.status === 'quote_sent_to_ho' || 
    q.status === 'ho_approved_invoice_required' || q.status === 'invoiced' || 
    q.status === 'invoice_paid' || q.status === 'scheduled'
  ).length;
  const rejectedQuotes = filteredQuotes.filter(q => 
    q.status === 'rejected' || q.status === 'ho_rejected'
  ).length;
  const totalValue = filteredQuotes.reduce((sum, q) => sum + (q.total || 0), 0);
  const avgQuoteValue = totalQuotes > 0 ? totalValue / totalQuotes : 0;

  // Open vs Closed buckets (closed = invoice_paid + scheduled)
  const openQuotes = allQuotes.filter(q => !["invoice_paid", "scheduled"].includes(q.status));
  const closedQuotes = allQuotes.filter(q => ["invoice_paid", "scheduled"].includes(q.status));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">ENquote Dashboard</h1>
          <p className="text-slate-600 mt-1">Performance metrics and workflow insights</p>
        </div>

        {/* Site Flag Banner */}
        <SiteFlagBanner flags={siteFlags} />

        {/* Coaching Feedback */}
        {currentUser && <CoachingFeedback currentUserEmail={currentUser.email} />}

        {/* Status Alerts */}
        <StatusAlerts quotes={allQuotes} />

        {/* Filters */}
        <Card className="p-4 mb-6 border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-900">Filters</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600 mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft_without_internal">Draft w/o Internal</SelectItem>
                  <SelectItem value="draft_without_fst">Draft w/o FST</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="quote_sent_to_ho">Sent to HO</SelectItem>
                  <SelectItem value="ho_approved_invoice_required">HO Approved</SelectItem>
                  <SelectItem value="invoiced">Invoiced</SelectItem>
                  <SelectItem value="invoice_paid">Paid</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-600 mb-1 block">Coordinator</label>
              <Select value={coordinatorFilter} onValueChange={setCoordinatorFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Coordinators</SelectItem>
                  {coordinators.map(coord => (
                    <SelectItem key={coord} value={coord}>{coord}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Open / Closed Quote Buckets */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <MetricCard
            title="Open Quotes"
            value={openQuotes.length}
            subtitle={`$${(openQuotes.reduce((s, q) => s + (q.total || 0), 0) / 1000).toFixed(1)}k total value`}
            icon={FolderOpen}
            index={0}
            href={createPageUrl("QuoteOverview?bucket=open")}
            iconBg="bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-200"
          />
          <MetricCard
            title="Closed Quotes"
            value={closedQuotes.length}
            subtitle={`$${(closedQuotes.reduce((s, q) => s + (q.total || 0), 0) / 1000).toFixed(1)}k total value`}
            icon={FolderCheck}
            index={1}
            href={createPageUrl("QuoteOverview?bucket=closed")}
            iconBg="bg-gradient-to-br from-emerald-400 to-teal-500 shadow-emerald-200"
          />
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            title="Total Quotes"
            value={totalQuotes}
            icon={FileText}
            index={0}
            href={createPageUrl("Quotes")}
          />
          <MetricCard
            title="Approved"
            value={approvedQuotes}
            subtitle={`${submittedQuotes > 0 ? ((approvedQuotes / submittedQuotes) * 100).toFixed(0) : 0}% approval rate`}
            icon={CheckCircle}
            index={1}
            href={createPageUrl("Quotes?status=approved")}
          />
          <MetricCard
            title="Rejected"
            value={rejectedQuotes}
            subtitle={`${submittedQuotes > 0 ? ((rejectedQuotes / submittedQuotes) * 100).toFixed(0) : 0}% of submitted`}
            icon={XCircle}
            index={2}
            href={createPageUrl("Quotes?status=rejected")}
          />
          <MetricCard
            title="Total Value"
            value={`$${(totalValue / 1000).toFixed(1)}k`}
            subtitle={`Avg: $${avgQuoteValue.toFixed(0)}`}
            icon={TrendingUp}
            index={3}
            href={createPageUrl("RevenueAnalytics")}
          />
        </div>

        {/* SLA Metrics */}
        <div className="mb-6">
          <SLAMetrics quotes={filteredQuotes} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <StatusChart quotes={filteredQuotes} />
          <TrendChart quotes={filteredQuotes} />
        </div>

        {/* Coordinator Performance */}
        <CoordinatorPerformance quotes={filteredQuotes} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <RoleGuard>
      <DashboardContent />
    </RoleGuard>
  );
}
