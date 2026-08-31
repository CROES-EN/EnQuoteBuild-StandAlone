import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { getQuotes } from "@/api/dataClient";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { subDays, parseISO, isAfter } from "date-fns";
import { BarChart3, DollarSign, Download, Users } from "lucide-react";
import RoleGuard from "@/components/auth/RoleGuard";
import CoordinatorBreakdown from "@/components/sla/CoordinatorBreakdown";
import WeeklyInflow from "@/components/sla/WeeklyInflow.jsx";
import SLAStageTimes from "@/components/sla/SLAStageTimes.jsx";
import StuckQuotes from "@/components/sla/StuckQuotes.jsx";
import StatusSnapshot from "@/components/sla/StatusSnapshot.jsx";
import WeeklyRevenue from "@/components/sla/WeeklyRevenue.jsx";
import QuarterlyRevenueSummary from "@/components/sla/QuarterlyRevenueSummary.jsx";
import QuarterlySLASummary from "@/components/sla/QuarterlySLASummary.jsx";
import QuotePipelineFunnel from "@/components/sla/QuotePipelineFunnel.jsx";
import { Button } from "@/components/ui/button";
import { exportQuoteSLAToExcel } from "@/utils/quoteSLAExport";

function SLAReportingContent() {
  const [dateRange, setDateRange] = useState("90");

  const { data: allQuotes = [], isLoading } = useQuery({
    queryKey: ["quotes-sla"],
    queryFn: async () => {
    const qs = await getQuotes();
    return qs
        .filter(q => q.is_current_version !== false && (!q.exclude_from_reporting || q.status === "on_hold"))
        .map(q => ({
          ...q,
          status: (!q.status || q.status === "draft") ? "draft_without_internal" : q.status
        }));
    }
  });

  const cutoff = subDays(new Date(), parseInt(dateRange));
  const filteredQuotes = allQuotes.filter(q => isAfter(parseISO(q.created_date), cutoff) && q.status !== "on_hold");
  const metricsQuotes = allQuotes.filter(q => q.status !== "on_hold");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Reporting</h1>
            <p className="text-slate-500 mt-1">SLA lifecycle timing, revenue flow & quarterly summaries</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => exportQuoteSLAToExcel(allQuotes)}>
              <Download className="w-4 h-4" />
              Export SLA Data
            </Button>
            <label className="text-sm text-slate-600">Date Range:</label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 6 months</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs defaultValue="sla">
          <TabsList className="mb-6">
            <TabsTrigger value="sla" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> SLA Performance
            </TabsTrigger>
            <TabsTrigger value="revenue" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Revenue Flow
            </TabsTrigger>
            <TabsTrigger value="coordinators" className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Coordinator Performance
            </TabsTrigger>
          </TabsList>

          {/* SLA Tab */}
          <TabsContent value="sla" className="space-y-6">
            <WeeklyInflow quotes={filteredQuotes} dateRange={dateRange} />
            <StatusSnapshot quotes={filteredQuotes} allQuotes={allQuotes} />
            <SLAStageTimes quotes={metricsQuotes} />
            <QuarterlySLASummary quotes={metricsQuotes} />
            <StuckQuotes quotes={metricsQuotes} />
          </TabsContent>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="space-y-6">
            <QuotePipelineFunnel quotes={metricsQuotes} />
            <WeeklyRevenue quotes={filteredQuotes} dateRange={dateRange} />
            <QuarterlyRevenueSummary quotes={metricsQuotes} />
          </TabsContent>

          {/* Coordinator Performance Tab */}
          <TabsContent value="coordinators" className="space-y-6">
            <CoordinatorBreakdown quotes={allQuotes.filter(q => q.status !== "on_hold" && isAfter(parseISO(q.created_date), cutoff))} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function SLAReporting() {
  return (
    <RoleGuard allowedRoles={["admin", "approver", "submitter"]}>
      <SLAReportingContent />
    </RoleGuard>
  );
}