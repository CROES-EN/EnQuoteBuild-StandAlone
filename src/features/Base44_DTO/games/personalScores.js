import {getCurrentUserNamespace, scopedKey} from "@/lib/userScopedStorage";
import {betterArcadeScore, validArcadeScore} from "../../../../shared/arcadeScores.js";

const KEY = "enspace_personal_scores_v1";
export function readPersonalScores() {
  const raw = window.localStorage.getItem(scopedKey(KEY));
  if (!raw) return {};
  const scores = JSON.parse(raw);
  if (!scores || typeof scores !== "object" || Array.isArray(scores) ||
      Object.entries(scores).some(([kind, value]) => !validArcadeScore(kind, value))) {
    throw new Error("Saved personal scores are invalid.");
  }
  return scores;
}
export function recordPersonalScore(kind, value) {
  if (getCurrentUserNamespace() === "__anonymous__") throw new Error("Sign in before saving a personal best.");
  const scores = readPersonalScores();
  if (betterArcadeScore(kind, value, scores[kind])) {
    scores[kind] = value;
    window.localStorage.setItem(scopedKey(KEY), JSON.stringify(scores));
  }
  return scores[kind];
}
