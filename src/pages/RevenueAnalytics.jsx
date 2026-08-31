import { getQuotes } from "@/api/dataClient";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  ArrowLeft, 
  TrendingUp, 
  DollarSign, 
  Calendar,
  FileText,
  CheckCircle,
  Clock,
  Receipt
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import RoleGuard from "@/components/auth/RoleGuard";

function RevenueAnalyticsContent() {
  const { data: allQuotes = [], isLoading } = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
  const quotes = await getQuotes();

  return quotes.filter(
    q => q.is_current_version !== false
  );
}
  });

  // Calculate total revenue by status
  const revenueByStatus = {
    approved: allQuotes.filter(q => q.status === 'approved').reduce((sum, q) => sum + (q.total || 0), 0),
    sentToHO: allQuotes.filter(q => q.status === 'quote_sent_to_ho').reduce((sum, q) => sum + (q.total || 0), 0),
    hoApproved: allQuotes.filter(q => q.status === 'ho_approved_invoice_required').reduce((sum, q) => sum + (q.total || 0), 0),
    invoiced: allQuotes.filter(q => q.status === 'invoiced').reduce((sum, q) => sum + (q.total || 0), 0),
    paid: allQuotes.filter(q => ['invoice_paid', 'scheduled'].includes(q.status)).reduce((sum, q) => sum + (q.total || 0), 0),
  };

  const totalRevenue = Object.values(revenueByStatus).reduce((sum, val) => sum + val, 0);
  const paidRevenue = revenueByStatus.paid;
  const pendingRevenue = totalRevenue - paidRevenue;

  // Revenue by month (last 6 months)
  const monthlyRevenue = [];
  for (let i = 5; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(new Date(), i));
    const monthEnd = endOfMonth(subMonths(new Date(), i));
    
    const monthQuotes = allQuotes.filter(q => {
      const quoteDate = parseISO(q.created_date);
      return quoteDate >= monthStart && quoteDate <= monthEnd;
    });
    
    monthlyRevenue.push({
      month: format(monthStart, "MMM yyyy"),
      total: monthQuotes.reduce((sum, q) => sum + (q.total || 0), 0),
      paid: allQuotes.filter(q => {
        if (!q.invoice_paid_date) return false;
        const paidDate = parseISO(q.invoice_paid_date);
        return paidDate >= monthStart && paidDate <= monthEnd;
      }).reduce((sum, q) => sum + (q.total || 0), 0),
    });
  }

  // Revenue by coordinator
  const coordinatorRevenue = {};
  allQuotes.forEach(q => {
    if (q.created_by) {
      if (!coordinatorRevenue[q.created_by]) {
        coordinatorRevenue[q.created_by] = 0;
      }
      coordinatorRevenue[q.created_by] += q.total || 0;
    }
  });

  const topCoordinators = Object.entries(coordinatorRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, revenue]) => ({
      name: name.split('@')[0],
      revenue
    }));

  // Revenue pipeline breakdown
  const pipelineData = [
    { name: "Paid", value: revenueByStatus.paid, color: "#10b981" },
    { name: "Invoiced", value: revenueByStatus.invoiced, color: "#6366f1" },
    { name: "HO Approved", value: revenueByStatus.hoApproved, color: "#f59e0b" },
    { name: "Sent to HO", value: revenueByStatus.sentToHO, color: "#8b5cf6" },
    { name: "Approved", value: revenueByStatus.approved, color: "#3b82f6" },
  ].filter(item => item.value > 0);

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
          <Link to={createPageUrl("Dashboard")}>
            <Button variant="ghost" className="text-slate-600 mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-indigo-600" />
            Revenue Analytics
          </h1>
          <p className="text-slate-600 mt-1">Comprehensive breakdown of revenue and financial metrics</p>
        </div>

        {/* Key Revenue Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="p-6 border-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Total Revenue</p>
                <p className="text-3xl font-bold text-slate-900">${(totalRevenue / 1000).toFixed(1)}k</p>
                <p className="text-sm text-slate-500 mt-1">All approved quotes</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Paid Revenue</p>
                <p className="text-3xl font-bold text-emerald-600">${(paidRevenue / 1000).toFixed(1)}k</p>
                <p className="text-sm text-slate-500 mt-1">{totalRevenue > 0 ? ((paidRevenue / totalRevenue) * 100).toFixed(0) : 0}% collected</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Pending Revenue</p>
                <p className="text-3xl font-bold text-amber-600">${(pendingRevenue / 1000).toFixed(1)}k</p>
                <p className="text-sm text-slate-500 mt-1">{totalRevenue > 0 ? ((pendingRevenue / totalRevenue) * 100).toFixed(0) : 0}% pending</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
                <Clock className="w-6 h-6 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">Avg Quote Value</p>
                <p className="text-3xl font-bold text-slate-900">
                  ${allQuotes.length > 0 ? (totalRevenue / allQuotes.length).toFixed(0) : 0}
                </p>
                <p className="text-sm text-slate-500 mt-1">Per quote</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                <FileText className="w-6 h-6 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* Revenue Pipeline */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="p-6 border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Revenue Pipeline</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pipelineData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: $${(value / 1000).toFixed(1)}k`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pipelineData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6 border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Revenue by Status</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm text-slate-600">Invoice Paid</span>
                </div>
                <span className="font-semibold text-slate-900">${(revenueByStatus.paid / 1000).toFixed(1)}k</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-indigo-500" />
                  <span className="text-sm text-slate-600">Invoiced</span>
                </div>
                <span className="font-semibold text-slate-900">${(revenueByStatus.invoiced / 1000).toFixed(1)}k</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  <span className="text-sm text-slate-600">HO Approved</span>
                </div>
                <span className="font-semibold text-slate-900">${(revenueByStatus.hoApproved / 1000).toFixed(1)}k</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <span className="text-sm text-slate-600">Sent to HO</span>
                </div>
                <span className="font-semibold text-slate-900">${(revenueByStatus.sentToHO / 1000).toFixed(1)}k</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-sm text-slate-600">Approved</span>
                </div>
                <span className="font-semibold text-slate-900">${(revenueByStatus.approved / 1000).toFixed(1)}k</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Monthly Revenue Trend */}
        <Card className="p-6 border-slate-200 mb-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Monthly Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyRevenue}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
              <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} name="Total Revenue" />
              <Line type="monotone" dataKey="paid" stroke="#10b981" strokeWidth={2} name="Paid Revenue" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Top Coordinators by Revenue */}
        <Card className="p-6 border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Top Coordinators by Revenue</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topCoordinators}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
              <Bar dataKey="revenue" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

export default function RevenueAnalytics() {
  return (
    <RoleGuard>
      <RevenueAnalyticsContent />
    </RoleGuard>
  );
}