// Hard-coded tab access per role. This is an allow-list: a restricted role sees ONLY the pages
// listed here, so any page added in the future stays hidden from it until added below.
// Admins are never restricted, and a role not listed here (e.g. invoicer) is unrestricted.
export const ROLE_PAGE_ACCESS = Object.freeze({
  submitter: [
    "Dashboard",
    "Workload",
    "Quotes",
    "AutoDrafter",
    "Products",
    "MaterialOrders",
    "PVPanelRMAs",
    "SLAReporting",
    "Boneyard",
    "SVCancelTracker",
    "ResourcePlanner",
    "SiteFlagManager",
    "InactiveRevenueDashboard",
    "EnphaseCare"
  ],
  approver: [
    "Dashboard",
    "Workload",
    "Quotes",
    "AutoDrafter",
    "Products",
    "MaterialOrders",
    "PVPanelRMAs",
    "SLAReporting",
    "Boneyard",
    "SVCancelTracker",
    "ResourcePlanner",
    "SiteFlagManager",
    "InactiveRevenueDashboard",
    "EnphaseCare"
  ]
});

// Tolerates malformed role data (null, a single string, an object) instead of crashing the
// whole layout: anything that is not an array becomes a list (one role for a string, else none).
export function toRoleList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

// Admin overrides everything. A user holding several roles is restricted only if every one of
// their roles is restricted, and then sees the union of those roles' pages.
export function canAccessPage(userRoles, page, isAdmin) {
  const roles = toRoleList(userRoles);
  if (isAdmin || roles.includes("admin") || roles.includes("super_admin")) return true;
  if (!roles.length) return true;
  if (roles.some(role => !Array.isArray(ROLE_PAGE_ACCESS[role]))) return true;
  return roles.some(role => ROLE_PAGE_ACCESS[role].includes(page));
}
