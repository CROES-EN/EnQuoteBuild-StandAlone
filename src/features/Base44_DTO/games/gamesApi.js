const MESSAGES = {
  game_conflict: "The match changed on another screen. Refresh the match before trying again.",
  not_your_turn: "It is your opponent's turn.",
  cards_still_visible: "Wait for the unmatched cards to turn over.",
  invalid_move: "That square or card is no longer available.",
  fleet_already_ready: "Your fleet is locked. Wait for your opponent to finish placing ships.",
  fleet_incomplete: "Place all five ships before marking your fleet ready.",
  game_not_active: "This match is not active.",
  game_expired: "This challenge or match has expired.",
  game_not_found: "This match is no longer available to your account.",
  recipient_not_allowed: "Choose another active EnQuote teammate.",
  challenge_limit_or_existing: "A match with that teammate already exists for this game, or you have 20 open challenges.",
  invalid_score: "That score is outside the supported completed-game range.",
  not_found: "Online games require the updated EnQuote Worker and games database migration.",
  http_404: "Online games require the updated EnQuote Worker and games database migration."
};
export function hasOnlineGames() {
  return typeof globalThis.window?.enquoteLocal?.retroGames?.act === "function";
}
export function hasSharedScores() {
  return typeof globalThis.window?.enquoteLocal?.retroGames?.score === "function";
}
async function call(method, ...args) {
  const fn = globalThis.window?.enquoteLocal?.retroGames?.[method];
  if (typeof fn !== "function") throw new Error("Online challenges require the new EnQuote desktop release. Local games are available now.");
  let result;
  try {
    result = await fn(...args);
  } catch (error) {
    if (!/No handler registered for/.test(error.message)) throw error;
    const restart = new Error("Fully quit EnQuote, including its tray icon, and restart the updated desktop build to load online games.");
    restart.code = "desktop_restart_required";
    throw restart;
  }
  if (!result || result.ok === false) {
    const code = result?.reason || result?.error;
    const error = new Error(MESSAGES[code] || result?.error || "Could not load online games.");
    error.code = code;
    throw error;
  }
  return result;
}
export const gamesApi = {
  list: () => call("list"),
  get: id => call("get", id),
  act: payload => call("act", payload),
  scores: () => call("scores"),
  score: payload => call("score", payload)
};
