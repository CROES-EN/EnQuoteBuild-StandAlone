/**
 * User-configurable "important case count" goal for the Workload page - per explicit request:
 * "allow the user to set a goal and once the case drops below that number it celebrates" since
 * different people carry different workloads/case counts, so one fixed threshold wouldn't fit
 * everyone. Stored per-browser/per-PC in localStorage (same pattern as
 * tableColumnPreferences.js), NOT synced anywhere - this is a personal display preference, not
 * shared team data.
 *
 * FIX (per explicit request - "make sure any of the customizable settings are locked per
 * user"): this previously stored the goal under ONE fixed key shared by EVERYONE signed in on
 * the same PC. Now uses userScopedStorage.js's scopedKey() to namespace the storage key by the
 * CURRENTLY SIGNED-IN user, so each person's goal is fully independent, even on a shared PC.
 *
 * v2 FIX: automatic migration of an old, pre-fix shared value has been REMOVED (see
 * themeStore.js's v2 comment for the full explanation) - it was found to leak one person's
 * settings into another person's account the first time they signed in. Every user now starts
 * from DEFAULT_WORKLOAD_GOAL until they personally set their own goal.
 */

import {scopedKey} from "@/lib/userScopedStorage";

const STORAGE_KEY = "enquote_workload_important_goal";

/** Sensible starting point if the user has never set one - roughly "a small, healthy backlog". */
export const DEFAULT_WORKLOAD_GOAL = 5;

/** Returns the user's saved goal, or DEFAULT_WORKLOAD_GOAL if never set or invalid. */
export function getWorkloadGoal() {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY));
    if (raw === null) return DEFAULT_WORKLOAD_GOAL;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_WORKLOAD_GOAL;
  } catch {
    return DEFAULT_WORKLOAD_GOAL;
  }
}

/** Persists a new goal. Silently ignores invalid input rather than throwing, since this is a
 *  low-stakes UI preference, not something that should ever break the page. */
export function setWorkloadGoal(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return;
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), String(parsed));
  } catch {
    // Ignore storage failures (e.g. private-browsing quota) - in-memory state still works.
  }
}
