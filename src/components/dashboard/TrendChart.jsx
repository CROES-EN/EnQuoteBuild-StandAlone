import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, parseISO, startOfDay, differenceInDays } from "date-fns";

export default function TrendChart({ quotes, dateRange }) {
  // Group quotes by date
  const groupedByDate = quotes.reduce((acc, quote) => {
    const date = format(startOfDay(parseISO(quote.created_date)), 'MMM dd');
    if (!acc[date]) {
      acc[date] = { date, submitted: 0, approved: 0, rejected: 0 };
    }
    
    if (quote.status === 'submitted' || quote.status === 'approved' || quote.status === 'rejected' || 
        quote.status === 'quote_sent_to_ho' || quote.status === 'ho_approved_invoice_required' || 
        quote.status === 'invoiced' || quote.status === 'invoice_paid' || quote.status === 'scheduled') {
      acc[date].submitted += 1;
    }
    if (quote.status === 'approved' || quote.status === 'quote_sent_to_ho' || 
        quote.status === 'ho_approved_invoice_required' || quote.status === 'invoiced' || 
        quote.status === 'invoice_paid' || quote.status === 'scheduled') {
      acc[date].approved += 1;
    }
    if (quote.status === 'rejected' || quote.status === 'ho_rejected') {
      acc[date].rejected += 1;
    }
    
    return acc;
  }, {});

  const data = Object.values(groupedByDate).sort((a, b) => {
    return new Date(a.date) - new Date(b.date);
  });

  return (
    <Card className="p-6 border-slate-200">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Quote Activity Trend</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis 
            dataKey="date" 
            tick={{ fill: '#64748b', fontSize: 12 }}
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
          <Legend />
          <Line 
            type="monotone" 
            dataKey="submitted" 
            stroke="#3b82f6" 
            strokeWidth={2}
            name="Submitted"
            dot={{ fill: '#3b82f6', r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="approved" 
            stroke="#10b981" 
            strokeWidth={2}
            name="Approved"
            dot={{ fill: '#10b981', r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="rejected" 
            stroke="#ef4444" 
            strokeWidth={2}
            name="Rejected"
            dot={{ fill: '#ef4444', r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}