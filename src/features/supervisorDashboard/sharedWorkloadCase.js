import {APP_LINK_QUERY, validAppTarget} from "../../../shared/appLinkRules.js";

export function sharedWorkloadCase(search) {
  const value = new URLSearchParams(search).get(APP_LINK_QUERY);
  if (!value) return null;
  let target;
  try {target = JSON.parse(value);}
  catch {return null;}
  return validAppTarget(target) && target.kind === "record" &&
    target.value.startsWith("workload-case:") && target.value.slice(14).trim()
    ? target.value : null;
}
