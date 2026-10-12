import {STRATEGY_KINDS, initialStrategy, publicStrategy} from "./arcadeStrategy.js";

export const ONLINE_GAME_NAMES = {tic: "Tic-Tac-Toe", memory: "Memory Match", connect: "Connect Four", battleship: "Battleship", checkers: "Checkers"};
export const MEMORY_SYMBOLS = ["SUN", "MOON", "STAR", "LEAF", "WAVE", "BOLT", "GEM", "HEART"];

export function memoryDeck(random = Math.random) {
  const cards = [...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function ticTacToeResult(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? "draw" : null;
}

export function initialOnlineGame(kind, challenger, opponent) {
  if (STRATEGY_KINDS.includes(kind)) return initialStrategy(kind, challenger, opponent);
  return kind === "tic"
    ? {turn: challenger, winner: null, board: Array(9).fill(null)}
    : {turn: challenger, winner: null, cards: memoryDeck(), open: [], matched: [], revealUntil: 0,
      scores: {[challenger]: 0, [opponent]: 0}};
}

export function onlineMove(game, email, index, now) {
  if (game.status !== "active") return {error: "game_not_active"};
  if (game.state.turn !== email) return {error: "not_your_turn"};
  const state = game.state;
  const other = email === game.challenger ? game.opponent : game.challenger;
  if (!Number.isInteger(index) || index < 0 || index >= (game.kind === "tic" ? 9 : 16)) return {error: "invalid_move"};
  if (game.kind === "tic") {
    if (state.board[index]) return {error: "invalid_move"};
    const board = [...state.board];
    board[index] = email === game.challenger ? "X" : "O";
    const result = ticTacToeResult(board);
    return {status: result ? "finished" : "active", state: {...state, board,
      turn: result ? null : other, winner: result === "draw" ? "draw" : result === "X" ? game.challenger : result === "O" ? game.opponent : null}};
  }
  if (state.revealUntil > now) return {error: "cards_still_visible"};
  const open = state.revealUntil ? [] : state.open;
  if (state.matched.includes(index) || open.includes(index)) return {error: "invalid_move"};
  const nextOpen = [...open, index];
  if (nextOpen.length === 1) return {status: "active", state: {...state, open: nextOpen, revealUntil: 0}};
  if (state.cards[nextOpen[0]] !== state.cards[nextOpen[1]]) {
    return {status: "active", state: {...state, open: nextOpen, revealUntil: now + 1500, turn: other}};
  }
  const matched = [...state.matched, ...nextOpen];
  const scores = {...state.scores, [email]: state.scores[email] + 1};
  const finished = matched.length === 16;
  const winner = scores[game.challenger] === scores[game.opponent] ? "draw" :
    scores[game.challenger] > scores[game.opponent] ? game.challenger : game.opponent;
  return {status: finished ? "finished" : "active", state: {...state, matched, scores, open: [], revealUntil: 0,
    turn: finished ? null : email, winner: finished ? winner : null}};
}

export function publicOnlineGame(game, now = Date.now(), email) {
  const {state, ...record} = game;
  const status = game.status === "pending" && game.expiresAt <= now ? "expired" : game.status;
  if (STRATEGY_KINDS.includes(game.kind)) return {...record, status, ...publicStrategy(game, email)};
  if (game.kind === "tic") return {...record, status, ...state};
  const open = state.revealUntil && state.revealUntil <= now ? [] : state.open;
  const visible = new Set([...state.matched, ...open]);
  return {...record, status, ...state, open,
    cards: state.cards.map((card, index) => visible.has(index) ? card : null)};
}
