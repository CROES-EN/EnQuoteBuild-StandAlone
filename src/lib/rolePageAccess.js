export const ALL_PAGES = Object.freeze([
  "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "CreateQuote", "EditQuote", "QuoteDetails",
  "QuoteOverview", "AutoDrafter", "Products", "MaterialOrders", "PVPanelRMAs", "SLAReporting",
  "Boneyard", "SVCancelTracker", "ResourcePlanner", "SOPLibrary", "SiteFlagManager", "EnphaseCare",
  "InactiveRevenueDashboard", "InactiveCollections", "RevenueAnalytics", "Users", "QuoteDeletionRequests",
  "EmailNotifications", "FollowUpSettings", "PDFTemplateSettings", "ManagerDashboard", "SupervisorDashboard",
  "RejectedQuoteReview"
]);

// Matches the pre-1.4.0 effective access exactly (old allow-list ∩ each page's RoleGuard), so nothing
// changes until an admin edits the matrix in the Admin Menu.
export const DEFAULT_ROLE_PAGES = Object.freeze({
  submitter: [
    "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "AutoDrafter", "Products", "MaterialOrders",
    "PVPanelRMAs", "SLAReporting", "Boneyard", "SVCancelTracker", "ResourcePlanner", "SOPLibrary",
    "SiteFlagManager", "EnphaseCare"
  ],
  approver: [
    "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "AutoDrafter", "Products", "MaterialOrders",
    "PVPanelRMAs", "SLAReporting", "Boneyard", "SVCancelTracker", "ResourcePlanner", "SOPLibrary",
    "SiteFlagManager", "EnphaseCare", "InactiveRevenueDashboard"
  ],
  invoicer: [
    "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "QuoteDetails", "QuoteOverview", "AutoDrafter",
    "Boneyard", "SOPLibrary", "RejectedQuoteReview", "EnphaseCare", "InactiveRevenueDashboard", "InactiveCollections"
  ],
  admin: ALL_PAGES,
  super_admin: ALL_PAGES
});

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

export function toRoleList(value) {
  if (Array.isArray(value)) return value.map((role) => String(role || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function rolesForUser(userOrRoles) {
  if (Array.isArray(userOrRoles) || typeof userOrRoles === "string") return toRoleList(userOrRoles);
  return toRoleList([userOrRoles?.app_role, ...toRoleList(userOrRoles?.additional_roles)]);
}

export function canAccessPage(userOrRoles, page, policy = null) {
  const pageName = String(page || "").trim();
  if (!pageName) return true;
  const user = Array.isArray(userOrRoles) || typeof userOrRoles === "string" ? null : userOrRoles;
  const roles = rolesForUser(userOrRoles);
  const denyPages = new Set(toRoleList(user?.deny_pages));
  const allowPages = new Set(toRoleList(user?.allow_pages));
  if (denyPages.has(pageName)) return false;
  if (allowPages.has(pageName)) return true;
  if (roles.some((role) => ADMIN_ROLES.has(role))) return true;
  if (!roles.length) return false;
  const rolePages = policy?.rolePages || DEFAULT_ROLE_PAGES;
  return roles.some((role) => toRoleList(rolePages?.[role]).includes(pageName));
}

export function pageFromPathname(pathname) {
  const clean = String(pathname || "").split("?")[0].split("#")[0].replace(/^\/+/, "");
  if (!clean) return "Dashboard";
  return clean.split("/")[0] || "Dashboard";
}
