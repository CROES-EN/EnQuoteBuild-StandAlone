import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const statusColors = {
  draft: "#94a3b8",
  submitted: "#3b82f6",
  approved: "#10b981",
  rejected: "#ef4444",
  quote_sent_to_ho: "#8b5cf6",
  ho_approved_invoice_required: "#f59e0b",
  ho_rejected: "#dc2626",
  invoiced: "#6366f1",
  invoice_paid: "#059669",
  scheduled: "#0d9488"
};

const statusLabels = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  quote_sent_to_ho: "Sent to HO",
  ho_approved_invoice_required: "HO Approved",
  ho_rejected: "HO Rejected",
  invoiced: "Invoiced",
  invoice_paid: "Paid",
  scheduled: "Scheduled"
};

export default function StatusChart({ quotes }) {
  const statusCounts = quotes.reduce((acc, quote) => {
    acc[quote.status] = (acc[quote.status] || 0) + 1;
    return acc;
  }, {});

  const data = Object.entries(statusCounts).map(([status, count]) => ({
    status: statusLabels[status] || status,
    count,
    color: statusColors[status] || "#94a3b8"
  }));

  return (
    <Card className="p-6 border-slate-200">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Quotes by Status</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis 
            dataKey="status" 
            tick={{ fill: '#64748b', fontSize: 12 }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#ffffff', 
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
            }}
          />
          <Bar dataKey="count" radius={[8, 8, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}