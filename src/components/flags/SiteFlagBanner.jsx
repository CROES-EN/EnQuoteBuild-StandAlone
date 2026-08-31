import { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { AlertTriangle, ShieldAlert, Siren, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const FLAG_CONFIG = {
  red: {
    label: "Critical Review Required",
    bg: "bg-red-50 border-red-400",
    header: "bg-red-100",
    text: "text-red-900",
    subtext: "text-red-700",
    badge: "bg-red-600 text-white",
    icon: Siren,
    iconColor: "text-red-600",
    rowHover: "hover:bg-red-100",
    rowBg: "bg-white",
  },
  orange: {
    label: "Level 2 Warning",
    bg: "bg-orange-50 border-orange-400",
    header: "bg-orange-100",
    text: "text-orange-900",
    subtext: "text-orange-700",
    badge: "bg-orange-500 text-white",
    icon: ShieldAlert,
    iconColor: "text-orange-500",
    rowHover: "hover:bg-orange-50",
    rowBg: "bg-white",
  },
  yellow: {
    label: "Level 1 Warning",
    bg: "bg-yellow-50 border-yellow-400",
    header: "bg-yellow-100",
    text: "text-yellow-900",
    subtext: "text-yellow-700",
    badge: "bg-yellow-400 text-yellow-900",
    icon: AlertTriangle,
    iconColor: "text-yellow-500",
    rowHover: "hover:bg-yellow-50",
    rowBg: "bg-white",
  },
};

function FlagGroup({ level, flags }) {
  const [expanded, setExpanded] = useState(level === "red");
  const cfg = FLAG_CONFIG[level];
  const Icon = cfg.icon;

  return (
    <div className={cn("rounded-xl border-2 overflow-hidden mb-4", cfg.bg)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn("w-full flex items-center justify-between px-5 py-3 font-semibold text-sm", cfg.header, cfg.text)}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("w-5 h-5", cfg.iconColor)} />
          <span>{cfg.label}</span>
          <span className={cn("ml-2 px-2 py-0.5 rounded-full text-xs font-bold", cfg.badge)}>
            {flags.length} site{flags.length !== 1 ? "s" : ""}
          </span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="divide-y divide-slate-100">
          {flags.map((flag) => (
            <div key={flag.id} className={cn("flex flex-col md:flex-row md:items-center gap-2 px-5 py-3 text-sm", cfg.rowBg, cfg.rowHover)}>
              <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                <div>
                  <p className="text-xs text-slate-400">Site ID</p>
                  <p className="font-bold text-slate-900">{flag.site_id}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Trigger</p>
                  <p className={cn("font-medium capitalize", cfg.subtext)}>
                    {flag.flag_source === "both" ? "Truckroll + Support" : flag.flag_source === "truckroll" ? "Truckroll" : "Support Contacts"}
                  </p>
                </div>
                {flag.truckroll_count > 0 && (
                  <div>
                    <p className="text-xs text-slate-400">Truckrolls</p>
                    <p className="font-semibold text-slate-800">{flag.truckroll_count}</p>
                  </div>
                )}
                {flag.support_contact_count > 0 && (
                  <div>
                    <p className="text-xs text-slate-400">Support (10d)</p>
                    <p className="font-semibold text-slate-800">{flag.support_contact_count}</p>
                  </div>
                )}
              </div>
              {flag.notes && (
                <p className="text-xs text-slate-500 md:max-w-xs truncate">{flag.notes}</p>
              )}
              <Link
                to={createPageUrl(`SiteFlagManager`)}
                className={cn("flex items-center gap-1 text-xs font-medium shrink-0 px-3 py-1.5 rounded-lg border transition-colors", cfg.subtext, "border-current hover:opacity-80")}
              >
                <ExternalLink className="w-3 h-3" />
                Review
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SiteFlagBanner({ flags }) {
  const active = flags.filter(f => !f.is_resolved);
  const red = active.filter(f => f.flag_level === "red");
  const orange = active.filter(f => f.flag_level === "orange");
  const yellow = active.filter(f => f.flag_level === "yellow");

  if (active.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Siren className="w-5 h-5 text-red-500" />
          Site Flags — Intervention Required
          <span className="ml-1 px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-xs font-bold">{active.length}</span>
        </h2>
        <Link to={createPageUrl("SiteFlagManager")} className="text-xs text-indigo-600 hover:underline font-medium">
          Manage All Flags →
        </Link>
      </div>
      {red.length > 0 && <FlagGroup level="red" flags={red} />}
      {orange.length > 0 && <FlagGroup level="orange" flags={orange} />}
      {yellow.length > 0 && <FlagGroup level="yellow" flags={yellow} />}
    </div>
  );
}