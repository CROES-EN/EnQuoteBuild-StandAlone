import {useState} from "react";
import {FLEET, checkerMoves} from "../../../../shared/arcadeStrategy.js";

const coordinate = index => `${String.fromCharCode(65 + index % 10)}${Math.floor(index / 10) + 1}`;

export default function StrategyBoards({game, me, locked, pending, send}) {
  const [selected, setSelected] = useState(null);
  const [ship, setShip] = useState(0);
  const [vertical, setVertical] = useState(false);
  if (game.kind === "connect") return <div className="space-y-2">
    <p>Drop a disc into a column. Connect four horizontally, vertically, or diagonally.</p>
    <p>Your discs are {game.challenger === me ? "X (cyan)" : "O (pink)"}.</p>
    <div className="enspace-strategy-grid" style={{gridTemplateColumns: "repeat(7, 1fr)"}} aria-label="Connect Four board">
      {Array.from({length: 7}, (_, index) => <button key={`drop-${index}`} className="enspace-arcade-action"
        disabled={locked || Boolean(game.board[index])} aria-label={`Drop in column ${index + 1}`}
        onClick={() => send("move", {index})}>{index + 1}</button>)}
      {game.board.map((side, index) => <div key={index} className={`enspace-strategy-cell ${side === game.opponent ? "is-opponent" : ""}`}
        aria-label={`Row ${Math.floor(index / 7) + 1}, column ${index % 7 + 1}: ${side ? side === game.challenger ? "X" : "O" : "empty"}`}>
        {side ? side === game.challenger ? "X" : "O" : "."}
      </div>)}
    </div>
  </div>;
  if (game.kind === "checkers") {
    const from = game.forced ?? selected;
    const moves = checkerMoves(game, me);
    return <div className="space-y-2">
      <p>American checkers: select your piece, then a highlighted destination. Captures are mandatory; continue multi-jumps. Crowning ends the turn. Draw after 80 turns without a capture or promotion.</p>
      <p>You play {game.challenger === me ? "X (cyan), moving up" : "O (pink), moving down"}. Kings show K.</p>
      <div className="enspace-strategy-grid" style={{gridTemplateColumns: "repeat(8, 1fr)"}} aria-label="Checkers board">
        {game.board.map((piece, index) => {
          const destination = moves.some(move => move.from === from && move.to === index);
          const selectable = moves.some(move => move.from === index);
          return <button key={index} type="button" disabled={locked || (!destination && !selectable)}
            aria-label={`Checkers row ${Math.floor(index / 8) + 1}, column ${index % 8 + 1}: ${piece ? `${piece.side === me ? "your" : "opponent"} ${piece.king ? "king" : "piece"}` : "empty"}`}
            aria-pressed={from === index}
            className={`enspace-strategy-cell ${(Math.floor(index / 8) + index % 8) % 2 ? "is-dark" : ""} ${piece?.side === game.opponent ? "is-opponent" : ""} ${destination ? "is-target" : ""}`}
            onClick={() => {
              if (destination) {send("move", {from, index}); setSelected(null);}
              else setSelected(index);
            }}>{piece ? `${piece.side === game.challenger ? "X" : "O"}${piece.king ? "K" : ""}` : destination ? "+" : ""}</button>;
        })}
      </div>
    </div>;
  }
  const setup = game.status === "active" && game.phase === "setup", ready = game.ready[me];
  const occupied = (game.fleet || []).flat();
  return <div className="space-y-3">
    <p>Place five ships (5, 4, 3, 3, 2 cells), then lock your fleet. Ships cannot overlap. Once both players are ready, fire one shot per turn. Sink all five enemy ships to win.</p>
    {setup && <div className="flex flex-wrap items-center gap-2">
      <label>Ship<select className="enspace-arcade-select" value={ship} disabled={pending || ready} onChange={event => setShip(Number(event.target.value))}>
        {FLEET.map((length, index) => <option key={index} value={index}>Ship {index + 1}: {length} cells{game.fleet[index] ? " (placed)" : ""}</option>)}
      </select></label>
      <button className="enspace-arcade-action" disabled={pending || ready} onClick={() => setVertical(value => !value)}>
        {vertical ? "Vertical" : "Horizontal"}
      </button>
      <button className="enspace-arcade-action" disabled={pending || ready} onClick={() => send("randomize")}>Randomize fleet</button>
      <button className="enspace-arcade-action" disabled={pending || ready || !FLEET.every((length, index) => game.fleet[index]?.length === length)}
        onClick={() => send("ready")}>Ready to battle</button>
      {ready && <p role="status">Fleet locked. Waiting for your opponent.</p>}
    </div>}
    <div className="flex flex-wrap gap-6">
      <section><h5>Your fleet</h5>
        <div className="enspace-strategy-grid enspace-sea-grid" aria-label="Your Battleship fleet">
          {Array.from({length: 100}, (_, index) => {
            const hit = game.incoming.includes(index), boat = occupied.includes(index);
            return <button key={index} type="button" className={`enspace-strategy-cell ${boat ? "is-target" : ""} ${hit ? "is-opponent" : ""}`}
              disabled={!setup || ready || pending} aria-label={`Fleet ${coordinate(index)}: ${boat ? "ship" : "water"}${hit ? ", fired on" : ""}`}
              onClick={() => send("place", {ship, index, vertical})}>{hit ? boat ? "X" : "." : boat ? "S" : ""}</button>;
          })}
        </div>
      </section>
      {!setup && <section><h5>Opponent waters - {game.sunk.length} ships sunk</h5>
        <div className="enspace-strategy-grid enspace-sea-grid" aria-label="Battleship targets">
          {Array.from({length: 100}, (_, index) => {
            const shot = game.shots.find(shot => shot.index === index);
            return <button key={index} type="button" disabled={locked || Boolean(shot)}
              className={`enspace-strategy-cell ${shot?.hit ? "is-opponent" : ""}`}
              aria-label={`Fire at ${coordinate(index)}: ${shot ? shot.hit ? "hit" : "miss" : "unknown"}`}
              onClick={() => send("move", {index})}>{shot ? shot.hit ? "X" : "." : "?"}</button>;
          })}
        </div>
      </section>}
    </div>
  </div>;
}
