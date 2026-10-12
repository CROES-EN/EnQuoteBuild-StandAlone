import {useEffect, useRef, useState} from "react";
import {newSnake, turnSnake, stepSnake, SNAKE_SIZE, newMemory, flipMemory, playTicTacToe, ticTacToeResult} from "./gameLogic";
import "./Arcade.css";
import MemoryIcon from "./MemoryIcon";
import OnlineArcade from "./OnlineArcade";
import Solitaire from "./Solitaire";
import NeonRider from "./NeonRider";
import HighScores, {useGameHighScore} from "./HighScores";
import {CircleDot, Ship, Grid3X3} from "lucide-react";

const GAMES = [
  {id: "snake", name: "Snake", description: "Collect food, grow your snake, and avoid the walls."},
  {id: "memory", name: "Memory Match", description: "Find all eight matching pairs in as few moves as possible."},
  {id: "tic", name: "Tic-Tac-Toe", description: "Play X against the computer. Can you force a draw?"},
  {id: "solitaire", name: "Solitaire", description: "Classic draw-one Klondike. Build all four suits from Ace to King."},
  {id: "rider", name: "Neon Rider", description: "Draw your own rails, build ramps, and send a rider down the track."},
  {id: "connect", name: "Connect Four", online: true, icon: CircleDot, description: "Challenge a teammate to four-in-a-row. Saved online so you can resume later."},
  {id: "battleship", name: "Battleship", online: true, icon: Ship, description: "Place your private fleet and battle a teammate. Ship placements and turns save online."},
  {id: "checkers", name: "Checkers", online: true, icon: Grid3X3, description: "Challenge a teammate with captures, multi-jumps, and kings. Resume your saved match anytime."}
];
function ArcadeButton({children, ...props}) {
  return <button type="button" className="enspace-arcade-action" {...props}>{children}</button>;
}

function Snake() {
  const [state, setState] = useState(newSnake);
  const [runId, setRunId] = useState(() => crypto.randomUUID());
  const boardRef = useRef(null);
  const outlineRef = useRef(null);
  const bodyRef = useRef(null);
  const headRef = useRef(null);
  const movement = useRef(null);
  const running = state.status === "running";
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setState(current => {
      const next = stepSnake(current);
      if (next.status === "running" || next.status === "won") {
        movement.current = {from: current.body, to: next.body, fromDirection: current.direction,
          toDirection: next.direction, time: performance.now()};
      }
      return next;
    }), 160);
    const pauseWhenHidden = () => {
      if (document.hidden) setState(current => current.status === "running" ? {...current, status: "paused"} : current);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {clearInterval(timer); document.removeEventListener("visibilitychange", pauseWhenHidden);};
  }, [running]);
  useEffect(() => {
    if (!running) return undefined;
    let frame;
    const draw = time => {
      const move = movement.current;
      if (move) {
        const progress = Math.max(0, Math.min(1, (time - move.time) / 160));
        const cells = move.to.map((cell, index) => {
          const from = move.from[index] || move.from.at(-1);
          return {x: from.x + (cell.x - from.x) * progress, y: from.y + (cell.y - from.y) * progress};
        });
        const points = cells.map(cell => `${cell.x * 10 + 5},${cell.y * 10 + 5}`).join(" ");
        outlineRef.current?.setAttribute("points", points);
        bodyRef.current?.setAttribute("points", points);
        const angles = {right: 0, down: 90, left: 180, up: 270};
        const fromAngle = angles[move.fromDirection], toAngle = angles[move.toDirection];
        const turn = ((toAngle - fromAngle + 540) % 360) - 180;
        headRef.current?.setAttribute("transform", `translate(${cells[0].x * 10 + 5} ${cells[0].y * 10 + 5}) rotate(${fromAngle + turn * progress})`);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [running]);
  const pause = () => setState(current => current.status === "running" ? {...current, status: "paused"} : current);
  const start = () => {
    setState(current => ({...current, status: "running"}));
    boardRef.current?.focus();
  };
  const steer = direction => {
    setState(current => turnSnake(current, direction));
    boardRef.current?.focus();
  };
  const keys = {ArrowUp: "up", w: "up", ArrowDown: "down", s: "down",
    ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right"};
  const displayBody = running && movement.current ? movement.current.from : state.body;
  const head = displayBody[0];
  const angle = {right: 0, down: 90, left: 180, up: 270}[running && movement.current ? movement.current.fromDirection : state.direction];
  const points = displayBody.map(cell => `${cell.x * 10 + 5},${cell.y * 10 + 5}`).join(" ");
  const ended = state.status === "lost" || state.status === "won";
  const highScore = useGameHighScore("snake", ended ? state.score : null, runId);
  return <div className="space-y-3">
    <p>Use arrow keys or WASD while the board is focused, or use the direction buttons. Space pauses. Leaving the board pauses the game.</p>
    <p className="enspace-score" role="status" aria-live="polite">Score: {state.score}. {state.status === "lost" ? "Game over!" : state.status === "won" ? "You filled the board!" : state.status === "running" ? "Playing" : state.status === "paused" ? "Paused" : "Ready"}</p>
    {highScore}
    <div ref={boardRef} tabIndex={0} role="group" aria-label="Snake board. Arrow keys or WASD steer. Space pauses."
      onBlur={pause} onKeyDown={event => {
        const direction = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
        if (direction) {event.preventDefault(); steer(direction);}
        else if (event.key === " ") {event.preventDefault(); if (running) pause(); else if (!ended) start();}
      }}
      className="enspace-snake-board aspect-square w-full max-w-sm overflow-hidden">
      <svg aria-hidden="true" viewBox={`0 0 ${SNAKE_SIZE * 10} ${SNAKE_SIZE * 10}`} className="h-full w-full">
        {state.food && <g transform={`translate(${state.food.x * 10 + 5} ${state.food.y * 10 + 5})`}>
          <path d="M0-2C-6-6-6 5-1 4L1 4C6 5 6-6 0-2" fill="#f68bda" />
          <path d="M0-2Q-1-6 3-6" fill="none" stroke="#97fa8d" strokeWidth="1.5" />
        </g>}
        <polyline ref={outlineRef} points={points} fill="none" stroke="#2f7653" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <polyline ref={bodyRef} points={points} fill="none" stroke="#97fa8d" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 1" />
        <g ref={headRef} data-testid="arcade-snake-head" transform={`translate(${head.x * 10 + 5} ${head.y * 10 + 5}) rotate(${angle})`}>
          <path d="M4 0H7M7 0L9-1M7 0L9 1" stroke="#f68bda" strokeWidth="0.7" fill="none" />
          <ellipse rx="5" ry="4" fill="#97fa8d" />
          <circle cx="2" cy="-2" r="1.2" fill="#100b22" /><circle cx="2" cy="2" r="1.2" fill="#100b22" />
          <circle cx="2.3" cy="-2.3" r="0.4" fill="white" /><circle cx="2.3" cy="1.7" r="0.4" fill="white" />
        </g>
      </svg>
    </div>
    <div className="flex flex-wrap gap-2">
      {!running && !ended && <ArcadeButton onClick={start}>{state.status === "ready" ? "Start" : "Resume"}</ArcadeButton>}
      {running && <ArcadeButton onClick={pause}>Pause</ArcadeButton>}
      <ArcadeButton onClick={() => {movement.current = null; setState(newSnake()); setRunId(crypto.randomUUID());}}>New game</ArcadeButton>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Snake direction controls">
      {["up", "left", "down", "right"].map(direction => <ArcadeButton key={direction}
        onPointerDown={event => event.preventDefault()} onClick={() => steer(direction)}>
        {direction[0].toUpperCase() + direction.slice(1)}
      </ArcadeButton>)}
    </div>
  </div>;
}

function MemoryMatch() {
  const [state, setState] = useState(newMemory);
  const [runId, setRunId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (state.open.length !== 2) return undefined;
    const timer = setTimeout(() => setState(current => ({...current, open: []})), 900);
    return () => clearTimeout(timer);
  }, [state.open]);
  const won = state.matched.length === state.cards.length;
  const highScore = useGameHighScore("memory", won ? state.moves : null, runId);
  return <div className="space-y-3">
    <p>Turn over two cards to find a pair. Unmatched cards hide after a short pause.</p>
    <p className="enspace-score" role="status" aria-live="polite">{won ? `All pairs found in ${state.moves} moves!` : `Moves: ${state.moves}. Pairs: ${state.matched.length / 2} of 8.`}</p>
    {highScore}
    <div className="grid max-w-md grid-cols-4 gap-2">
      {state.cards.map((symbol, index) => {
        const matched = state.matched.includes(index);
        const visible = matched || state.open.includes(index);
        return <button key={index} type="button" disabled={matched || state.open.includes(index) || state.open.length === 2}
          aria-label={`Card ${index + 1}: ${visible ? symbol : "face down"}${matched ? ", matched" : ""}`}
          onClick={() => setState(current => flipMemory(current, index))}
          className={`enspace-memory-card aspect-square text-xs font-bold ${visible ? "is-revealed" : ""} ${matched ? "is-matched" : ""}`}>
          {visible ? <MemoryIcon symbol={symbol} /> : "?"}{matched && <span className="block text-[10px]">Matched</span>}
        </button>;
      })}
    </div>
    <ArcadeButton onClick={() => {setState(newMemory()); setRunId(crypto.randomUUID());}}>New game</ArcadeButton>
  </div>;
}

function TicTacToe() {
  const [board, setBoard] = useState(() => Array(9).fill(null));
  const result = ticTacToeResult(board);
  return <div className="space-y-3">
    <p>You are X. The computer plays O. Select an empty square to play.</p>
    <p className="enspace-score" role="status" aria-live="polite">{result === "draw" ? "It's a draw!" : result ? `${result === "X" ? "You win" : "The computer wins"}!` : "Your turn (X)."}</p>
    <div className="grid max-w-xs grid-cols-3 gap-2">
      {board.map((value, index) => <button key={index} type="button" disabled={Boolean(value || result)}
        aria-label={`Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}: ${value || "empty"}`}
        onClick={() => setBoard(current => playTicTacToe(current, index))}
        className={`enspace-tic-cell aspect-square text-3xl font-bold ${value === "O" ? "is-computer" : ""}`}>
        {value}
      </button>)}
    </div>
    <ArcadeButton onClick={() => setBoard(Array(9).fill(null))}>New game</ArcadeButton>
  </div>;
}

export default function Arcade() {
  const [game, setGame] = useState(null);
  const selected = GAMES.find(item => item.id === game);
  return <section aria-label="EnSpace Games" className="enspace-arcade mt-3 space-y-5 p-4 sm:p-6">
    <header className="enspace-arcade-marquee space-y-2">
      <h2 className="text-2xl font-bold sm:text-3xl">EnSpace Games</h2>
      <p className="text-sm">No quarters required. Play locally or challenge a teammate. Work records stay untouched.</p>
    </header>
    {!selected && !["online", "scores"].includes(game) ? <><div className="flex flex-wrap gap-2">
      <ArcadeButton onClick={() => setGame("online")}>Challenge a teammate</ArcadeButton>
      <ArcadeButton onClick={() => setGame("scores")}>High scores</ArcadeButton>
    </div>
    <p>Two-player challenges: Tic-Tac-Toe, Memory Match, Connect Four, Battleship, and Checkers. Online matches save so you can resume later.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      {GAMES.map((item, index) => <div key={item.id} className="enspace-arcade-cabinet space-y-3 p-4">
        <div aria-hidden="true" className={`enspace-cabinet-art enspace-cabinet-art-${item.id}`}>
          {item.icon ? <item.icon size={48} /> : item.id === "snake" ? <span className="enspace-pixel-snake" /> :
            item.id === "memory" ? <MemoryIcon symbol="GEM" /> : item.id === "tic" ? <span className="text-4xl">X O</span> :
              item.id === "solitaire" ? <MemoryIcon symbol="HEART" /> : <span className="text-4xl">/\/</span>}
        </div>
        <p className="enspace-arcade-eyebrow">CABINET 0{index + 1}</p>
        <h3 className="font-bold">{item.name}</h3>
        {item.online && <p className="enspace-arcade-eyebrow">ONLINE / 2 PLAYERS / AUTO-SAVED</p>}
        <p className="text-sm">{item.description}</p>
        <ArcadeButton onClick={() => setGame(item.id)}>Play {item.name}</ArcadeButton>
      </div>)}
    </div></> : <div className="space-y-3">
      <ArcadeButton onClick={() => setGame(null)}>Back to games</ArcadeButton>
      {game !== "scores" && <h3 className="text-lg font-bold">{game === "online" ? "Online challenges" : selected.name}</h3>}
      {game === "scores" ? <HighScores /> : game === "online" || selected?.online ? <OnlineArcade key={game} initialKind={selected?.online ? selected.id : "tic"} /> : game === "snake" ? <Snake /> : game === "memory" ? <MemoryMatch /> :
        game === "solitaire" ? <Solitaire /> : game === "rider" ? <NeonRider /> : <TicTacToe />}
    </div>}
    <footer className="enspace-arcade-eyebrow border-t border-[#514275] pt-3">LOCAL PLAY / TEAM CHALLENGES / HIGH SCORES / TAKE A BREAK</footer>
  </section>;
}
