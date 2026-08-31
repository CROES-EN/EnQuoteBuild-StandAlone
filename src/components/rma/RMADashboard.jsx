import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { getDaysOpen, getDaysInCurrentStatus, RMA_STATUSES, STATUS_COLORS } from "@/components/rma/rmaUtils";
import { FolderOpen, CheckCircle2, Clock, Timer } from "lucide-react";

function MetricCard({ icon: Icon, label, value, color }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center shrink-0`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-slate-500 truncate">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </Card>
  );
}

export default function RMADashboard({ rmas }) {
  const openCount = rmas.filter(r => r.current_status !== "Closed").length;
  const closedCount = rmas.filter(r => r.current_status === "Closed").length;
  const avgDaysOpen = rmas.length
    ? Math.round(rmas.reduce((sum, r) => sum + getDaysOpen(r), 0) / rmas.length)
    : 0;
  const avgDaysInStatus = rmas.length
    ? Math.round(rmas.reduce((sum, r) => sum + getDaysInCurrentStatus(r), 0) / rmas.length)
    : 0;

  const statusData = RMA_STATUSES
    .map(s => ({ name: s, value: rmas.filter(r => r.current_status === s).length }))
    .filter(d => d.value > 0);

  const manufacturerData = [...new Set(rmas.map(r => r.panel_manufacturer).filter(Boolean))]
    .map(m => ({ name: m, value: rmas.filter(r => r.panel_manufacturer === m).length }))
    .sort((a, b) => b.value - a.value);

  const ownerData = [...new Set(rmas.map(r => r.case_owner).filter(Boolean))]
    .map(o => ({ name: o, value: rmas.filter(r => r.case_owner === o).length }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={FolderOpen} label="Total Open RMAs" value={openCount} color="bg-blue-500" />
        <MetricCard icon={CheckCircle2} label="Total Closed RMAs" value={closedCount} color="bg-emerald-500" />
        <MetricCard icon={Clock} label="Average Days Open" value={avgDaysOpen} color="bg-amber-500" />
        <MetricCard icon={Timer} label="Average Days in Status" value={avgDaysInStatus} color="bg-violet-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">RMAs by Status</h3>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={statusData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {statusData.map((entry, i) => (
                    <Cell key={i} fill={STATUS_COLORS[entry.name] || "#6366f1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-16">No data available</p>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">RMAs by Manufacturer</h3>
          {manufacturerData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={manufacturerData} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={70} interval={0} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-16">No data available</p>
          )}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">RMAs by Case Owner</h3>
          {ownerData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ownerData} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={70} interval={0} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-16">No data available</p>
          )}
        </Card>
      </div>
    </div>
  );
}