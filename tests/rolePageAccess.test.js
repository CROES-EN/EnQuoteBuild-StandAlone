import assert from "node:assert/strict";
import test from "node:test";
import {ALL_PAGES, DEFAULT_ROLE_PAGES, canAccessPage, pageFromPathname} from "../src/lib/rolePageAccess.js";

test("canAccessPage applies deny, allow, admin, then role page policy", () => {
  const user = { app_role: "submitter", additional_roles: ["invoicer"], allow_pages: ["Users"], deny_pages: ["Dashboard"] };
  assert.equal(canAccessPage(user, "Dashboard"), false);
  assert.equal(canAccessPage(user, "Users"), true);
  assert.equal(canAccessPage({ app_role: "admin" }, "Anything"), true);
  assert.equal(canAccessPage(user, "InactiveCollections"), true);
  assert.equal(canAccessPage(user, "SupervisorDashboard", { rolePages: { submitter: ["SupervisorDashboard"], invoicer: [] } }), true);
  assert.equal(canAccessPage({ app_role: "submitter" }, "SupervisorDashboard", { rolePages: { submitter: [] } }), false);
});

test("default role pages keep pre-1.4.0 access: admins see everything, others only their old pages", () => {
  assert.deepEqual(DEFAULT_ROLE_PAGES.admin, ALL_PAGES);
  assert.deepEqual(DEFAULT_ROLE_PAGES.super_admin, ALL_PAGES);
  assert.equal(canAccessPage({ app_role: "admin" }, "SupervisorDashboard"), true);
  assert.equal(canAccessPage({ app_role: "approver" }, "SupervisorDashboard"), false);
  assert.equal(canAccessPage({ app_role: "approver" }, "SupervisorDashboard", { rolePages: { approver: ["SupervisorDashboard"] } }), true);
  assert.equal(canAccessPage({ app_role: "approver", allow_pages: ["SupervisorDashboard"] }, "SupervisorDashboard"), true);
  assert.equal(canAccessPage({ app_role: "submitter" }, "InactiveRevenueDashboard"), false);
  assert.equal(canAccessPage({ app_role: "approver" }, "InactiveRevenueDashboard"), true);
  assert.equal(canAccessPage({ app_role: "submitter" }, "Users"), false);
});

test("pageFromPathname maps routes to page names", () => {
  assert.equal(pageFromPathname("/SupervisorDashboard?tab=workload"), "SupervisorDashboard");
  assert.equal(pageFromPathname("/"), "Dashboard");
});
