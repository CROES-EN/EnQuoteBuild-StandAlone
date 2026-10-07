import {ALL_PAGES, explainPageAccess, rolesForUser} from "../../lib/rolePageAccess.js";

export function canPreviewUserAccess(actor, policyState) {
  const policy = policyState?.policy;
  const email = String(actor?.email || "").trim().toLowerCase();
  return Boolean(
    email && !policyState?.loading && !policyState?.error &&
    policy?.ok === true && !policy.offline &&
    String(policy.me?.email || "").trim().toLowerCase() === email &&
    rolesForUser(policy.me).includes("super_admin")
  );
}

export function userAccessPreview(actor, policyState, target, rolePages) {
  if (!canPreviewUserAccess(actor, policyState)) throw new Error("A live, verified Super Admin policy is required for access preview.");
  if (!target?.email) throw new Error("Select a user from the current service account list.");
  return ALL_PAGES.map(page => ({page, ...explainPageAccess(target, page, {rolePages})}));
}
