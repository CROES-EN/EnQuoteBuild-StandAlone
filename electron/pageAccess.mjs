export const ALL_PAGES = Object.freeze([
  "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "CreateQuote", "EditQuote", "QuoteDetails",
  "QuoteOverview", "AutoDrafter", "Products", "MaterialOrders", "PVPanelRMAs", "SLAReporting",
  "Boneyard", "SVCancelTracker", "ResourcePlanner", "SOPLibrary", "SiteFlagManager", "EnphaseCare",
  "InactiveRevenueDashboard", "InactiveCollections", "RevenueAnalytics", "Users", "QuoteDeletionRequests",
  "EmailNotifications", "FollowUpSettings", "PDFTemplateSettings", "SupervisorDashboard",
  "RejectedQuoteReview", "Base44_DTO"
]);

// Defaults preserve legacy access except for viewing pages explicitly available to all roles.
export const DEFAULT_ROLE_PAGES = Object.freeze({
  submitter: [
    "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "AutoDrafter", "Products", "MaterialOrders",
    "PVPanelRMAs", "SLAReporting", "Boneyard", "SVCancelTracker", "ResourcePlanner", "SOPLibrary",
    "SiteFlagManager", "EnphaseCare", "InactiveRevenueDashboard", "InactiveCollections"
  ],
  approver: [
    "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "AutoDrafter", "Products", "MaterialOrders",
    "PVPanelRMAs", "SLAReporting", "Boneyard", "SVCancelTracker", "ResourcePlanner", "SOPLibrary",
    "SiteFlagManager", "EnphaseCare", "InactiveRevenueDashboard", "InactiveCollections"
  ],
  invoicer: [
    "Dashboard", "Workload", "Tasks", "Messages", "Quotes", "QuoteDetails", "QuoteOverview", "AutoDrafter",
    "Boneyard", "SOPLibrary", "RejectedQuoteReview", "EnphaseCare", "InactiveRevenueDashboard", "InactiveCollections"
  ],
  admin: ALL_PAGES,
  super_admin: ALL_PAGES
});

const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const ALL_ROLE_VIEW_PAGES = new Set(["Boneyard", "InactiveRevenueDashboard", "InactiveCollections", "Base44_DTO"]);

export function toRoleList(value) {
  if (Array.isArray(value)) return value.map((role) => String(role || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function rolesForUser(userOrRoles) {
  if (Array.isArray(userOrRoles) || typeof userOrRoles === "string") return toRoleList(userOrRoles);
  return toRoleList([userOrRoles?.app_role, ...toRoleList(userOrRoles?.additional_roles)]);
}

export function explainPageAccess(userOrRoles, page, policy = null) {
  const pageName = String(page || "").trim();
  if (!pageName) return {allowed: true, reason: "No page restriction"};
  const user = Array.isArray(userOrRoles) || typeof userOrRoles === "string" ? null : userOrRoles;
  const roles = rolesForUser(userOrRoles);
  const denyPages = new Set(toRoleList(user?.deny_pages));
  const allowPages = new Set(toRoleList(user?.allow_pages));
  if (denyPages.has(pageName)) return {allowed: false, reason: "Explicit hidden-page override (wins over every grant)"};
  if (allowPages.has(pageName)) return {allowed: true, reason: "Explicit allowed-page override"};
  if (roles.some((role) => ADMIN_ROLES.has(role))) return {allowed: true, reason: "Admin or Super Admin role"};
  if (!roles.length) return {allowed: false, reason: "No assigned role"};
  if (ALL_ROLE_VIEW_PAGES.has(pageName)) return {allowed: true, reason: "Shared viewing page available to every assigned role"};
  const rolePages = policy?.rolePages || DEFAULT_ROLE_PAGES;
  const grantingRoles = roles.filter((role) => toRoleList(rolePages?.[role]).includes(pageName));
  return grantingRoles.length
    ? {allowed: true, reason: `${policy?.rolePages ? "Configured" : "Default"} role pages: ${grantingRoles.join(", ")}`}
    : {allowed: false, reason: `Not granted by ${policy?.rolePages ? "configured" : "default"} role pages`};
}

export function canAccessPage(userOrRoles, page, policy = null) {
  return explainPageAccess(userOrRoles, page, policy).allowed;
}

export function pageFromPathname(pathname) {
  const clean = String(pathname || "").split("?")[0].split("#")[0].replace(/^\/+/, "");
  if (!clean) return "Dashboard";
  return clean.split("/")[0] || "Dashboard";
}
