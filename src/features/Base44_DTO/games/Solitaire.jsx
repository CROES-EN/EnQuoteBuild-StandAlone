import {useState} from "react";
import {Club, Diamond, Heart, Spade} from "lucide-react";
import {SUITS, cardColor, cardRank, newSolitaire, drawSolitaire, moveSolitaire, solitaireWon} from "./solitaireLogic";
import {useGameHighScore} from "./HighScores";

const SUIT_ICONS = {hearts: Heart, diamonds: Diamond, clubs: Club, spades: Spade};
function PlayingCard({card, selected, onClick}) {
  const Icon = SUIT_ICONS[card.suit];
  return <button type="button" onClick={onClick} disabled={!card.faceUp}
    aria-label={card.faceUp ? `${cardRank(card.rank)} of ${card.suit}${selected ? ", selected" : ""}` : "Face-down card"}
    aria-pressed={card.faceUp ? selected : undefined}
    className={`enspace-playing-card ${card.faceUp ? cardColor(card) === "red" ? "is-red" : "is-black" : "is-face-down"} ${selected ? "is-selected" : ""}`}>
    {card.faceUp ? <><span>{cardRank(card.rank)}</span><Icon aria-hidden="true" /></> : <span aria-hidden="true">EQ</span>}
  </button>;
}

export default function Solitaire() {
  const [state, setState] = useState(newSolitaire);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const [runId, setRunId] = useState(() => crypto.randomUUID());
  const highScore = useGameHighScore("solitaire", solitaireWon(state) ? state.moves : null, runId);
  const commit = next => {
    if (next === state) return;
    setHistory(previous => [...previous.slice(-99), state]);
    setState(next);
    setSelected(null);
    setMessage("");
  };
  const move = (destination, source = selected) => {
    if (!source) {setMessage("Select a face-up card, then choose its destination."); return;}
    const result = moveSolitaire(state, source, destination);
    if (result.error) setMessage(result.error);
    else commit(result.state);
  };
  const pick = (source, card) => {
    if (selected && (selected.pile !== source.pile || selected.index !== source.index)) {
      move({pile: source.pile, index: source.index});
    } else {setSelected(source); setMessage(`${cardRank(card.rank)} of ${card.suit} selected. Choose a destination.`);}
  };
  return <div className="space-y-3">
    <p>Classic draw-one Klondike. Select a face-up card or sequence, then a column or foundation. Use Move to foundation for a selected single card.</p>
    <p role="status" className="enspace-score">{solitaireWon(state) ? "You won!" : `Moves: ${state.moves}`}</p>
    {highScore}
    {message && <p role="status" aria-live="polite">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <button className="enspace-arcade-action" onClick={() => {setState(newSolitaire()); setHistory([]); setSelected(null); setMessage(""); setRunId(crypto.randomUUID());}}>New game</button>
      <button className="enspace-arcade-action" disabled={!history.length} onClick={() => {
        setState(history[history.length - 1]); setHistory(history.slice(0, -1)); setSelected(null); setMessage("");
      }}>Undo</button>
      <button className="enspace-arcade-action" disabled={!selected} onClick={() => {setSelected(null); setMessage("");}}>Clear selection</button>
      <button className="enspace-arcade-action" disabled={!selected} onClick={() => {
        const pile = selected.pile === "waste" ? state.waste :
          selected.pile === "foundation" ? state.foundations[selected.index] : state.tableau[selected.index];
        const card = pile[selected.pile === "tableau" ? selected.cardIndex : pile.length - 1];
        move({pile: "foundation", index: SUITS.indexOf(card.suit)});
      }}>Move to foundation</button>
    </div>
    <div className="enspace-solitaire-table overflow-x-auto pb-3">
      <div className="min-w-[560px] space-y-5">
        <div className="grid grid-cols-7 gap-2">
          <button type="button" className={`enspace-card-slot ${state.stock.length ? "is-stock" : ""}`}
            aria-label={state.stock.length ? `Draw a card. ${state.stock.length} in stock` : "Recycle waste"}
            onClick={() => commit(drawSolitaire(state))}>{state.stock.length ? "DRAW" : "RECYCLE"}</button>
          <div>{state.waste.length ? <PlayingCard card={state.waste.at(-1)} selected={selected?.pile === "waste"}
            onClick={() => pick({pile: "waste"}, state.waste.at(-1))} /> : <div className="enspace-card-slot">WASTE</div>}</div>
          <div />
          {SUITS.map((suit, index) => {
            const top = state.foundations[index].at(-1);
            return <div key={suit}>
              {top ? <PlayingCard card={top} selected={selected?.pile === "foundation" && selected.index === index}
                onClick={() => pick({pile: "foundation", index}, top)} /> :
                <button type="button" className="enspace-card-slot" aria-label={`Move to ${suit} foundation`}
                  onClick={() => move({pile: "foundation", index})}>{suit}<br />A to K</button>}
            </div>;
          })}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {state.tableau.map((pile, index) => <div key={index} className="enspace-tableau-column">
            {pile.map((card, cardIndex) => <PlayingCard key={card.id} card={card}
              selected={selected?.pile === "tableau" && selected.index === index && cardIndex >= selected.cardIndex}
              onClick={() => pick({pile: "tableau", index, cardIndex}, card)} />)}
            <button type="button" className="enspace-column-target" aria-label={`Move to column ${index + 1}`}
              onClick={() => move({pile: "tableau", index})}>Column {index + 1}{!pile.length ? " (King)" : ""}</button>
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}
