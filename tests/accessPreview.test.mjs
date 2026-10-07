import assert from "node:assert/strict";
import test from "node:test";
import {ALL_PAGES, canAccessPage, explainPageAccess} from "../src/lib/rolePageAccess.js";
import {canPreviewUserAccess, userAccessPreview} from "../src/features/admin/accessPreview.js";

const actor = {email: "operator@example.com", app_role: "super_admin"};
const live = me => ({loading: false, error: null, policy: {ok: true, me}});
const superPolicy = live(actor);

test("only same-account, live service Super Admin grants preview, including additional roles", () => {
  assert.equal(canPreviewUserAccess(actor, superPolicy), true);
  assert.equal(canPreviewUserAccess(actor, live({...actor, app_role: "admin"})), false);
  assert.equal(canPreviewUserAccess({email: actor.email, app_role: "admin"}, superPolicy), true);
  assert.equal(canPreviewUserAccess(actor, live({...actor, email: "someone@example.com"})), false);
  assert.equal(canPreviewUserAccess(actor, live({...actor, app_role: "submitter", additional_roles: ["super_admin"]})), true);
  for (const state of [
    null, {loading: true, policy: superPolicy.policy}, {...superPolicy, error: new Error("offline")},
    live(null), {policy: {...superPolicy.policy, ok: false}}, {policy: {...superPolicy.policy, offline: true}}
  ]) assert.equal(canPreviewUserAccess(actor, state), false);
  assert.equal(canPreviewUserAccess(null, superPolicy), false);
});

test("preview shares exact live page decisions without changing target or actor", () => {
  const target = {email: "heather@example.com", app_role: "admin", deny_pages: ["SupervisorDashboard"], allow_pages: ["SupervisorDashboard"]};
  const before = JSON.stringify({actor, target, superPolicy});
  const rows = userAccessPreview(actor, superPolicy, target, null);
  assert.equal(rows.length, ALL_PAGES.length);
  assert.equal(rows.find(row => row.page === "SupervisorDashboard").allowed, false);
  assert.match(rows.find(row => row.page === "SupervisorDashboard").reason, /Explicit hidden/);
  assert.equal(JSON.stringify({actor, target, superPolicy}), before);
  for (const row of rows) assert.equal(row.allowed, canAccessPage(target, row.page));
  assert.throws(() => userAccessPreview(actor, live({...actor, app_role: "admin"}), target, null), /Super Admin/);
  assert.throws(() => userAccessPreview(actor, superPolicy, null, null), /Select a user/);
});

test("access explanations preserve override, roles, shared-page and policy precedence", () => {
  const cases = [
    [{app_role: "submitter", allow_pages: ["SupervisorDashboard"]}, "SupervisorDashboard", null, /Explicit allowed/],
    [{app_role: "super_admin"}, "SupervisorDashboard", null, /Super Admin/],
    [{app_role: ""}, "Boneyard", null, /No assigned role/],
    [{app_role: "approver"}, "Boneyard", {rolePages: {}}, /Shared viewing/],
    [{app_role: "approver"}, "SupervisorDashboard", null, /Not granted by default/],
    [{app_role: "approver"}, "SupervisorDashboard", {rolePages: {approver: ["SupervisorDashboard"]}}, /Configured role pages/],
    [{app_role: "submitter", additional_roles: ["invoicer"]}, "QuoteDetails", null, /Default role pages: invoicer/]
  ];
  for (const [user, page, policy, reason] of cases) {
    assert.match(explainPageAccess(user, page, policy).reason, reason);
    assert.equal(explainPageAccess(user, page, policy).allowed, canAccessPage(user, page, policy));
  }
});
