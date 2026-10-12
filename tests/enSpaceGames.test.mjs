import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import postcss from "postcss";
import {contrastRatio} from "../src/features/theme/customThemeBuilder.js";
import {newSnake, snakeFood, turnSnake, stepSnake, SNAKE_SIZE,
  MEMORY_SYMBOLS, newMemory, flipMemory, playTicTacToe, ticTacToeResult} from "../src/features/Base44_DTO/games/gameLogic.js";

test("Snake starts with free food and rejects reversal and multiple turns in one tick", () => {
  const state = newSnake(() => 0);
  assert.equal(state.status, "ready");
  assert.equal(state.body.length, 3);
  assert.deepEqual(state.food, {x: 0, y: 0});
  assert.equal(turnSnake(state, "left"), state);
  assert.equal(turnSnake(state, "unknown"), state);
  const up = turnSnake(state, "up");
  assert.equal(turnSnake(up, "left"), up);
  const next = stepSnake({...up, status: "running"});
  assert.deepEqual(next.body[0], {x: 8, y: 7});
  assert.equal(next.direction, "up");
  assert.equal(turnSnake(next, "left").nextDirection, "left");
  assert.equal(stepSnake(state), state);
});

test("Snake grows, scores, collides, and can move into a vacated tail cell", () => {
  const state = {...newSnake(() => 0), status: "running", food: {x: 9, y: 8}};
  const grown = stepSnake(state, () => 0);
  assert.equal(grown.body.length, 4);
  assert.equal(grown.score, 1);
  assert.ok(!grown.body.some(cell => cell.x === grown.food.x && cell.y === grown.food.y));
  assert.equal(stepSnake({...state, body: [{x: 15, y: 8}]}).status, "lost");
  const loop = {...state, food: {x: 0, y: 0}, body: [{x: 1, y: 1}, {x: 1, y: 2}, {x: 2, y: 2}, {x: 2, y: 1}]};
  assert.equal(stepSnake(loop).status, "running", "tail cell is vacated on a non-growing move");
  assert.equal(stepSnake({...loop, body: [...loop.body, {x: 3, y: 1}]}).status, "lost");
});

test("filling the Snake board wins without an infinite food-placement loop", () => {
  const full = Array.from({length: SNAKE_SIZE * SNAKE_SIZE}, (_, i) => ({x: i % SNAKE_SIZE, y: Math.floor(i / SNAKE_SIZE)}));
  assert.equal(snakeFood(full), null);
  const body = [{x: 14, y: 15}, ...full.filter(cell => !(cell.y === 15 && cell.x >= 14))];
  const result = stepSnake({...newSnake(), status: "running", body, food: {x: 15, y: 15}});
  assert.equal(result.status, "won");
  assert.equal(result.food, null);
  assert.equal(result.body.length, full.length);
});

test("Memory Match has eight pairs, blocks duplicate/third flips, and counts complete moves", () => {
  let state = newMemory(() => 0.5);
  for (const symbol of MEMORY_SYMBOLS) assert.equal(state.cards.filter(card => card === symbol).length, 2);
  assert.equal(flipMemory(state, -1), state);
  state = flipMemory(state, 0);
  assert.equal(flipMemory(state, 0), state);
  assert.equal(state.moves, 0);
  const mismatch = state.cards.findIndex(card => card !== state.cards[0]);
  state = flipMemory(state, mismatch);
  assert.equal(state.moves, 1);
  assert.equal(state.open.length, 2);
  assert.equal(flipMemory(state, 2), state);
  state = {...state, open: []};
  for (const symbol of MEMORY_SYMBOLS) {
    const pair = state.cards.flatMap((card, index) => card === symbol ? [index] : []);
    state = flipMemory(flipMemory(state, pair[0]), pair[1]);
    assert.equal(state.open.length, 0);
    assert.equal(flipMemory(state, pair[0]), state);
  }
  assert.equal(state.matched.length, 16);
  assert.equal(state.moves, 9);
  const reset = newMemory();
  assert.equal(reset.moves, 0);
  assert.deepEqual(reset.matched, []);
});

test("Tic-Tac-Toe evaluates wins and draws and rejects occupied or finished squares", () => {
  assert.equal(ticTacToeResult(["X", "X", "X", null, "O", null, null, null, "O"]), "X");
  assert.equal(ticTacToeResult(["X", "O", "X", "X", "O", "O", "O", "X", "X"]), "draw");
  const first = playTicTacToe(Array(9).fill(null), 0);
  assert.equal(first[0], "X");
  assert.equal(first.filter(Boolean).length, 2);
  assert.equal(playTicTacToe(first, 0), first);
  const finished = ["O", "O", "O", "X", "X", null, null, null, null];
  assert.equal(playTicTacToe(finished, 5), finished);
});

test("Tic-Tac-Toe computer cannot lose on any legal player path", () => {
  let endings = 0;
  const visit = board => {
    const result = ticTacToeResult(board);
    assert.notEqual(result, "X");
    if (result) {endings++; return;}
    board.forEach((cell, index) => {if (!cell) visit(playTicTacToe(board, index));});
  };
  visit(Array(9).fill(null));
  assert.ok(endings > 100);
});

test("80s arcade colors meet AA without flashing effects or external font downloads", () => {
  const source = readFileSync(new URL("../src/features/Base44_DTO/games/Arcade.css", import.meta.url), "utf8");
  const css = postcss.parse(source);
  const declarations = new Map();
  css.walkRules(rule => {
    const values = {};
    rule.walkDecls(decl => {values[decl.prop] = decl.value;});
    declarations.set(rule.selector.replace(/\r\n/g, "\n"), values);
  });
  const base = declarations.get(".enspace-arcade");
  assert.ok(contrastRatio(base.color, base.background) >= 4.5);
  for (const selector of [
    ".enspace-arcade .enspace-arcade-action",
    ".enspace-arcade .enspace-arcade-action:hover",
    ".enspace-arcade .enspace-memory-card,\n.enspace-arcade .enspace-tic-cell"
  ]) {
    const values = declarations.get(selector);
    assert.ok(contrastRatio(values.color, values.background) >= 4.5, selector);
  }
  for (const color of ["#58edf3", "#f68bda", "#97fa8d", "#ffe680", "#cbbde6"]) {
    for (const background of ["#100b22", "#1d1533"]) {
      assert.ok(contrastRatio(color, background) >= 4.5, `${color} on ${background}`);
    }
  }
  assert.doesNotMatch(source, /@keyframes|animation:|@import|url\(/);
});
