export const FLEET = [5, 4, 3, 3, 2];
export const STRATEGY_KINDS = ["connect", "battleship", "checkers"];

export function shipCells(index, length, vertical) {
  if (!Number.isInteger(index) || index < 0 || index >= 100 || typeof vertical !== "boolean") return null;
  if (vertical ? Math.floor(index / 10) + length > 10 : index % 10 + length > 10) return null;
  return Array.from({length}, (_, offset) => index + offset * (vertical ? 10 : 1));
}

export function randomFleet(random = Math.random) {
  const ships = [];
  for (const length of FLEET) {
    const choices = [];
    for (let index = 0; index < 100; index++) for (const vertical of [false, true]) {
      const cells = shipCells(index, length, vertical);
      if (cells && !cells.some(cell => ships.flat().includes(cell))) choices.push(cells);
    }
    ships.push(choices[Math.floor(random() * choices.length)]);
  }
  return ships;
}

export function initialStrategy(kind, challenger, opponent) {
  const base = {turn: challenger, winner: null};
  if (kind === "connect") return {...base, board: Array(42).fill(null)};
  if (kind === "battleship") return {...base, turn: null, phase: "setup",
    fleets: {[challenger]: [], [opponent]: []}, ready: {[challenger]: false, [opponent]: false},
    shots: {[challenger]: [], [opponent]: []}};
  return {...base, forced: null, quiet: 0, board: Array.from({length: 64}, (_, i) => {
    const row = Math.floor(i / 8), col = i % 8;
    return (row + col) % 2 === 1 && (row < 3 || row > 4)
      ? {side: row < 3 ? opponent : challenger, king: false, forward: row < 3 ? 1 : -1} : null;
  })};
}

export function checkerMoves(state, email) {
  const jumps = [], steps = [];
  state.board.forEach((piece, from) => {
    if (!piece || piece.side !== email || (state.forced !== null && state.forced !== from)) return;
    const row = Math.floor(from / 8), col = from % 8;
    const directions = piece.king ? [-1, 1] : [piece.forward];
    for (const dy of directions) for (const dx of [-1, 1]) {
      const r = row + dy, c = col + dx;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const adjacent = r * 8 + c;
      if (!state.board[adjacent] && state.forced === null) steps.push({from, to: adjacent});
      if (state.board[adjacent] && state.board[adjacent].side !== email) {
        const rr = row + dy * 2, cc = col + dx * 2;
        if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && !state.board[rr * 8 + cc])
          jumps.push({from, to: rr * 8 + cc, captured: adjacent});
      }
    }
  });
  return jumps.length ? jumps : state.forced !== null ? [] : steps;
}

export function strategyAction(game, email, body) {
  const state = game.state, other = email === game.challenger ? game.opponent : game.challenger;
  const invalid = {error: "invalid_move"};
  if (game.kind === "battleship" && state.phase === "setup") {
    if (state.ready[email]) return {error: "fleet_already_ready"};
    let fleet = state.fleets[email];
    if (body.action === "place") {
      if (!Number.isInteger(body.ship) || body.ship < 0 || body.ship >= FLEET.length) return invalid;
      const cells = shipCells(body.index, FLEET[body.ship], body.vertical);
      if (!cells || fleet.some((ship, i) => i !== body.ship && ship?.some(cell => cells.includes(cell)))) return invalid;
      fleet = [...fleet];
      fleet[body.ship] = cells;
    } else if (body.action === "randomize") fleet = randomFleet();
    else if (body.action === "ready") {
      if (!FLEET.every((length, i) => fleet[i]?.length === length)) return {error: "fleet_incomplete"};
      const ready = {...state.ready, [email]: true}, playing = ready[other];
      return {status: "active", state: {...state, ready, phase: playing ? "playing" : "setup", turn: playing ? game.challenger : null}};
    } else return {error: "invalid_game_action"};
    return {status: "active", state: {...state, fleets: {...state.fleets, [email]: fleet}}};
  }
  if (body.action !== "move") return {error: "invalid_game_action"};
  if (state.turn !== email) return {error: "not_your_turn"};
  if (game.kind === "connect") {
    const column = body.index;
    if (!Number.isInteger(column) || column < 0 || column > 6) return invalid;
    let row = 5;
    while (row >= 0 && state.board[row * 7 + column]) row--;
    if (row < 0) return invalid;
    const board = [...state.board], index = row * 7 + column;
    board[index] = email;
    let win = false;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let count = 1;
      for (const sign of [-1, 1]) {
        let r = row + dr * sign, c = column + dc * sign;
        while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r * 7 + c] === email) {
          count++; r += dr * sign; c += dc * sign;
        }
      }
      if (count >= 4) win = true;
    }
    const winner = win ? email : board.every(Boolean) ? "draw" : null;
    return {status: winner ? "finished" : "active", state: {...state, board, winner, turn: winner ? null : other}};
  }
  if (game.kind === "battleship") {
    const index = body.index;
    if (!Number.isInteger(index) || index < 0 || index >= 100 || state.shots[email].includes(index)) return invalid;
    const shots = {...state.shots, [email]: [...state.shots[email], index]};
    const winner = state.fleets[other].flat().every(cell => shots[email].includes(cell)) ? email : null;
    return {status: winner ? "finished" : "active", state: {...state, shots, winner, turn: winner ? null : other}};
  }
  const move = checkerMoves(state, email).find(move => move.from === body.from && move.to === body.index);
  if (!move) return invalid;
  const board = [...state.board], piece = board[move.from];
  const crowned = !piece.king && (Math.floor(move.to / 8) === (piece.forward === -1 ? 0 : 7));
  board[move.from] = null;
  board[move.to] = {...piece, king: piece.king || crowned};
  if (move.captured !== undefined) board[move.captured] = null;
  const next = {...state, board, forced: null, quiet: move.captured !== undefined || crowned ? 0 : state.quiet + 1};
  if (move.captured !== undefined && !crowned) {
    next.forced = move.to;
    if (checkerMoves(next, email).length) return {status: "active", state: next};
    next.forced = null;
  }
  const winner = !checkerMoves(next, other).length ? email : next.quiet >= 80 ? "draw" : null;
  return {status: winner ? "finished" : "active", state: {...next, winner, turn: winner ? null : other}};
}

export function publicStrategy(game, email) {
  const state = game.state;
  if (game.kind !== "battleship") return state;
  const other = email === game.challenger ? game.opponent : game.challenger;
  const target = state.fleets[other] || [];
  return {turn: state.turn, winner: state.winner, resignedBy: state.resignedBy, phase: state.phase, ready: state.ready,
    fleet: state.fleets[email], incoming: state.shots[other], shots: state.shots[email].map(index =>
      ({index, hit: target.some(ship => ship?.includes(index))})),
    sunk: target.filter(ship => ship?.length && ship.every(cell => state.shots[email].includes(cell)))};
}
