import test from "node:test";
import assert from "node:assert/strict";
import {newSolitaire, drawSolitaire, moveSolitaire, solitaireWon} from "../src/features/Base44_DTO/games/solitaireLogic.js";
import {newRider, stepRider, RIDER_RADIUS, STARTER_TRACK} from "../src/features/Base44_DTO/games/trackLogic.js";

const card = (suit, rank, faceUp = true) => ({id: `${suit}-${rank}`, suit, rank, faceUp});
const empty = () => ({stock: [], waste: [], tableau: Array.from({length: 7}, () => []), foundations: Array.from({length: 4}, () => []), moves: 0});

test("Klondike deals all 52 unique cards and reveals only each column's top card", () => {
  const state = newSolitaire(() => 0.5);
  assert.equal(state.stock.length, 24);
  assert.deepEqual(state.tableau.map(pile => pile.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set([...state.stock, ...state.tableau.flat()].map(item => item.id)).size, 52);
  for (const pile of state.tableau) {
    assert.ok(pile.at(-1).faceUp);
    assert.ok(pile.slice(0, -1).every(item => !item.faceUp));
  }
});

test("draw-one stock and waste recycling preserve card order without mutating undo snapshots", () => {
  const original = newSolitaire(() => 0.5);
  const top = original.stock.at(-1).id;
  let state = original;
  for (let i = 0; i < 24; i++) state = drawSolitaire(state);
  assert.equal(state.stock.length, 0);
  assert.equal(state.waste.length, 24);
  assert.equal(state.waste[0].id, top);
  assert.equal(original.stock.length, 24);
  state = drawSolitaire(state);
  assert.equal(state.stock.at(-1).id, top);
  assert.ok(state.stock.every(item => !item.faceUp));
  assert.equal(drawSolitaire(state).waste[0].id, top);
  assert.equal(drawSolitaire(empty()).moves, 0);
});

test("tableau sequences require descending alternating colors, Kings fill empty slots, and hidden cards turn up", () => {
  const state = empty();
  state.tableau[0] = [card("hearts", 2, false), card("spades", 7), card("hearts", 6)];
  state.tableau[1] = [card("diamonds", 8)];
  const move = moveSolitaire(state, {pile: "tableau", index: 0, cardIndex: 1}, {pile: "tableau", index: 1});
  assert.equal(move.state.tableau[1].length, 3);
  assert.equal(move.state.tableau[0][0].faceUp, true);
  assert.equal(state.tableau[0][0].faceUp, false, "undo snapshot stays unchanged");
  assert.ok(moveSolitaire(state, {pile: "tableau", index: 0, cardIndex: 0}, {pile: "tableau", index: 1}).error);
  assert.ok(moveSolitaire(state, {pile: "tableau", index: 0, cardIndex: 1}, {pile: "tableau", index: 2}).error);
  state.waste = [card("hearts", 13)];
  assert.equal(moveSolitaire(state, {pile: "waste"}, {pile: "tableau", index: 2}).state.tableau[2][0].rank, 13);
  state.tableau[1] = [card("clubs", 8)];
  assert.ok(moveSolitaire(state, {pile: "tableau", index: 0, cardIndex: 1}, {pile: "tableau", index: 1}).error);
});

test("foundations build the same suit from Ace to King and only accept one card", () => {
  let state = empty();
  state.waste = [card("hearts", 1)];
  state = moveSolitaire(state, {pile: "waste"}, {pile: "foundation", index: 0}).state;
  assert.equal(state.foundations[0][0].rank, 1);
  state.waste = [card("diamonds", 2)];
  assert.ok(moveSolitaire(state, {pile: "waste"}, {pile: "foundation", index: 0}).error);
  state.waste = [card("hearts", 3)];
  assert.ok(moveSolitaire(state, {pile: "waste"}, {pile: "foundation", index: 0}).error);
  state.waste = [card("hearts", 2)];
  assert.equal(moveSolitaire(state, {pile: "waste"}, {pile: "foundation", index: 0}).state.foundations[0].length, 2);
  assert.equal(solitaireWon(state), false);
  assert.equal(solitaireWon({...state, foundations: Array.from({length: 4}, () => Array(13).fill({}))}), true);
});

test("rider pauses without motion, gravity accelerates, and a horizontal rail supports the rider", () => {
  const ready = newRider();
  assert.equal(stepRider(ready, STARTER_TRACK), ready);
  let rider = {...newRider({x: 100, y: 10}), status: "riding"};
  const rail = [{a: {x: 0, y: 100}, b: {x: 300, y: 100}}];
  for (let i = 0; i < 240; i++) rider = stepRider(rider, rail);
  assert.ok(Math.abs(rider.y - (100 - RIDER_RADIUS)) < 0.1);
  assert.equal(rider.status, "riding");
  assert.ok(rider.elapsed > 1.9);
  const paused = {...rider, status: "paused"};
  assert.equal(stepRider(paused, rail), paused);
});

test("rider gains speed on slopes, falls off empty tracks, and tolerates zero-length segments", () => {
  let rider = {...newRider(), status: "riding"};
  for (let i = 0; i < 180; i++) rider = stepRider(rider, STARTER_TRACK);
  assert.ok(rider.x > 60);
  assert.ok(rider.vx > 0);
  let falling = {...newRider(), status: "riding"};
  for (let i = 0; i < 240; i++) falling = stepRider(falling, [{a: {x: 0, y: 0}, b: {x: 0, y: 0}}]);
  assert.equal(falling.status, "fallen");
  assert.ok(Number.isFinite(falling.y));
});

test("large maps allow riding past the original canvas bounds", () => {
  const rider = {...newRider({x: 1200, y: 700}), status: "riding"};
  assert.equal(stepRider(rider, []).status, "fallen");
  assert.equal(stepRider(rider, [], 1 / 120, {width: 14400, height: 8000}).status, "riding");
});
