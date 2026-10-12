export const SCORE_GAMES = {
  snake: {name: "Snake", direction: "highest", min: 0, max: 253},
  memory: {name: "Memory Match", direction: "lowest", min: 8, max: 10000},
  solitaire: {name: "Solitaire", direction: "lowest", min: 76, max: 100000}
};
export function validArcadeScore(kind, value) {
  const game = typeof kind === "string" && Object.hasOwn(SCORE_GAMES, kind) ? SCORE_GAMES[kind] : null;
  return Boolean(game && Number.isSafeInteger(value) && value >= game.min && value <= game.max);
}
export function betterArcadeScore(kind, value, previous) {
  if (!validArcadeScore(kind, value)) throw new Error("That score is outside the supported game range.");
  return previous === null || previous === undefined ||
    (SCORE_GAMES[kind].direction === "highest" ? value > previous : value < previous);
}
