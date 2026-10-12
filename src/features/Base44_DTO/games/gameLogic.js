export const SNAKE_SIZE = 16;
const DIRECTIONS = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};
const sameCell = (a, b) => a.x === b.x && a.y === b.y;

export function snakeFood(body, random = Math.random) {
  const empty = [];
  for (let y = 0; y < SNAKE_SIZE; y++) {
    for (let x = 0; x < SNAKE_SIZE; x++) {
      if (!body.some(cell => sameCell(cell, {x, y}))) empty.push({x, y});
    }
  }
  return empty.length ? empty[Math.floor(random() * empty.length)] : null;
}

export function newSnake(random = Math.random) {
  const body = [{x: 8, y: 8}, {x: 7, y: 8}, {x: 6, y: 8}];
  return {body, direction: "right", nextDirection: "right", food: snakeFood(body, random), score: 0, status: "ready"};
}

export function turnSnake(state, direction) {
  if (!DIRECTIONS[direction] || state.nextDirection !== state.direction) return state;
  const [x, y] = DIRECTIONS[state.direction];
  const [nextX, nextY] = DIRECTIONS[direction];
  return x + nextX === 0 && y + nextY === 0 ? state : {...state, nextDirection: direction};
}

export function stepSnake(state, random = Math.random) {
  if (state.status !== "running") return state;
  const [dx, dy] = DIRECTIONS[state.nextDirection];
  const head = {x: state.body[0].x + dx, y: state.body[0].y + dy};
  const eating = state.food && sameCell(head, state.food);
  const occupied = eating ? state.body : state.body.slice(0, -1);
  if (head.x < 0 || head.y < 0 || head.x >= SNAKE_SIZE || head.y >= SNAKE_SIZE ||
      occupied.some(cell => sameCell(cell, head))) return {...state, status: "lost"};
  const body = [head, ...state.body];
  if (!eating) body.pop();
  const food = eating ? snakeFood(body, random) : state.food;
  return {...state, body, food, direction: state.nextDirection,
    score: state.score + (eating ? 1 : 0), status: food ? "running" : "won"};
}

export function newMemory(random = Math.random) {
  return {cards: memoryDeck(random), open: [], matched: [], moves: 0};
}

export function flipMemory(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.cards.length ||
      state.open.length === 2 || state.open.includes(index) || state.matched.includes(index)) return state;
  const open = [...state.open, index];
  if (open.length === 1) return {...state, open};
  const matched = state.cards[open[0]] === state.cards[open[1]]
    ? [...state.matched, ...open] : state.matched;
  return {...state, open: matched !== state.matched ? [] : open, matched, moves: state.moves + 1};
}

function bestMove(board, player) {
  const result = ticTacToeResult(board);
  if (result) return {score: result === "O" ? 1 : result === "X" ? -1 : 0, index: null};
  let best = {score: player === "O" ? -Infinity : Infinity, index: null};
  for (const index of [4, 0, 2, 6, 8, 1, 3, 5, 7]) {
    if (board[index]) continue;
    const next = [...board];
    next[index] = player;
    const {score} = bestMove(next, player === "O" ? "X" : "O");
    if (best.index === null || (player === "O" ? score > best.score : score < best.score)) best = {score, index};
  }
  return best;
}

export function playTicTacToe(board, index) {
  if (!Number.isInteger(index) || index < 0 || index > 8 || board[index] || ticTacToeResult(board)) return board;
  const next = [...board];
  next[index] = "X";
  if (!ticTacToeResult(next)) next[bestMove(next, "O").index] = "O";
  return next;
}
import {memoryDeck, ticTacToeResult} from "../../../../shared/arcadeGames.js";
export {MEMORY_SYMBOLS, memoryDeck, ticTacToeResult} from "../../../../shared/arcadeGames.js";
