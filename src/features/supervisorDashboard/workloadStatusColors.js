/**
 * Base O&M Status color palette (28 values) + Project Picklist rule + live-age calculation for
 * the Workload page.
 *
 * O&M Status colors: 11 values reuse the EXACT SAME classes as the matching quote status in
 * src/components/quotes/StatusBadge.jsx. The rest use soft/theme-blended colors in the same
 * visual style. This base palette is the DEFAULT/fallback badge appearance for any status NOT
 * currently mapped to a user-customized tile (see workloadPreferences.js) - once a status is
 * mapped to a tile, that tile's own label/icon/color take over (see getOMStatusBadgeClasses'
 * `tileOverride` parameter), so customizing a tile also customizes its badge everywhere it
 * appears, keeping the two visually in sync automatically.
 *
 * Project Picklist colors remain a separate, simpler, non-customizable rule per original
 * request: Enphase Care = orange, On-Demand = green, else = default.
 */

import {
  isImportantOMStatus as _isImportantOMStatus,
  getImportantRowEmphasis as _getImportantRowEmphasis
} from "@/features/supervisorDashboard/workloadPreferences";

const OM_STATUS_COLORS = {
  "quote draft": { bg: "bg-muted", text: "text-foreground", dot: "bg-slate-400" },
  "quote pending approval": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  "quote approved": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  "rejected": { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  "quote sent to ho": { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  "quote pending payment": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "invoice paid": { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  "scheduled": { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-500" },
  "quote pending materials": { bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500" },
  "ho rejected": { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  "on hold (boneyard)": { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  "new": { bg: "bg-muted", text: "text-foreground", dot: "bg-slate-400" },
  "case - in progress": { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" },
  "assigned": { bg: "bg-sky-50", text: "text-sky-600", dot: "bg-sky-400" },
  "needs review": { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500" },
  "updated by client": { bg: "bg-yellow-100", text: "text-yellow-800", dot: "bg-yellow-600" },
  "quote requested": { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500" },
  "appointment booked": { bg: "bg-cyan-50", text: "text-cyan-700", dot: "bg-cyan-500" },
  "pending schedule": { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
  "waiting on customer": { bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-600" },
  "waiting on installer": { bg: "bg-orange-200", text: "text-orange-900", dot: "bg-orange-700" },
  "pending rma": { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
  "pending travel plan": { bg: "bg-violet-50", text: "text-violet-600", dot: "bg-violet-400" },
  "pending materials": { bg: "bg-fuchsia-50", text: "text-fuchsia-700", dot: "bg-fuchsia-500" },
  "remote troubleshooting": { bg: "bg-blue-50", text: "text-blue-600", dot: "bg-blue-400" },
  "escalated": { bg: "bg-red-100", text: "text-red-800", dot: "bg-red-600" },
  "follow-up required": { bg: "bg-rose-50", text: "text-rose-600", dot: "bg-rose-400" },
  "gateway upgrade": { bg: "bg-teal-50", text: "text-teal-600", dot: "bg-teal-400" }
};

const DEFAULT_STATUS_COLOR = { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-slate-300" };

/**
 * Every known O&M Status value, in a sensible display order - exported so
 * WorkloadSettingsPanel.jsx can build its "which statuses map to this tile" multi-select
 * without duplicating this list.
 */
export const ALL_OM_STATUS_VALUES = [
  "New", "Assigned", "Case - In Progress", "Needs Review", "Updated by Client",
  "Quote Requested", "Quote Draft", "Quote Pending Approval", "Quote Approved", "Rejected",
  "Quote Sent to HO", "Quote Pending Materials", "Quote Pending Payment", "Invoice Paid",
  "HO Rejected", "On Hold (Boneyard)", "Appointment Booked", "Pending Schedule",
  "Waiting on Customer", "Waiting on Installer", "Pending RMA", "Pending Travel Plan",
  "Pending Materials", "Remote Troubleshooting", "Escalated", "Follow-Up Required",
  "Gateway Upgrade", "Scheduled"
];

/**
 * Returns { bg, text, dot, label, icon? } for an O&M Status badge. If `tileOverride` is
 * provided (the user's own tile config for this status, from workloadPreferences.js), its
 * color/icon are used instead of the base palette - this is what keeps a customized tile's
 * appearance in sync with how that status's badge looks everywhere else in the table.
 */
export function getOMStatusBadgeClasses(value, tileOverride) {
  const label = String(value ?? "").trim();
  if (!label) return { ...DEFAULT_STATUS_COLOR, label: "--" };
  if (tileOverride) {
    return { bg: tileOverride.bg, text: tileOverride.text, dot: tileOverride.dot, icon: tileOverride.icon, label };
  }
  const key = label.toLowerCase();
  const config = OM_STATUS_COLORS[key] || DEFAULT_STATUS_COLOR;
  return { ...config, label };
}

const DEFAULT_PICKLIST_COLOR = { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-slate-300" };
const ENPHASE_CARE_COLOR = { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" };
const ON_DEMAND_COLOR = { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" };

/** Returns { bg, text, dot, label } for a Project Picklist value - not user-customizable. */
export function getProjectPicklistBadgeClasses(value) {
  const label = String(value ?? "").trim();
  if (!label) return { ...DEFAULT_PICKLIST_COLOR, label: "--" };
  const key = label.toLowerCase();
  if (key.includes("enphase care")) return { ...ENPHASE_CARE_COLOR, label };
  if (key.includes("on-demand") || key.includes("on demand")) return { ...ON_DEMAND_COLOR, label };
  return { ...DEFAULT_PICKLIST_COLOR, label };
}

/**
 * Live equivalent of the user's own Excel formula:
 *   =IF([@[Case Date/Time Last Modified]]="","",TODAY()-INT([@[Case Date/Time Last Modified]]))
 * Computed fresh every render from the raw imported date value.
 */
export function calcOpenDays(caseLastModifiedValue) {
  const raw = String(caseLastModifiedValue ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const modifiedMidnight = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((todayMidnight.getTime() - modifiedMidnight.getTime()) / msPerDay);
  return days;
}

// ---------------------------------------------------------------------------------------------
// Backward-compatible re-exports (Layout.jsx's sidebar-badge feature imports
// isImportantOMStatus directly from THIS file, from before "importance" became fully
// user-customizable via tiles). Rather than re-patch Layout.jsx again, "importance" now simply
// delegates to workloadPreferences.js's tile-based definition - a status is important if it's
// mapped to any user-defined tile, instead of a fixed hardcoded list. Layout.jsx's existing
// import and call site continue to work completely unchanged.
// ---------------------------------------------------------------------------------------------
export function isImportantOMStatus(value) {
  return _isImportantOMStatus(value);
}

export function getImportantRowEmphasis(value) {
  return _getImportantRowEmphasis(value);
}
