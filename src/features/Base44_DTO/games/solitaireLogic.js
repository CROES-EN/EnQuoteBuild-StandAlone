export const SUITS = ["hearts", "diamonds", "clubs", "spades"];
export const cardColor = card => ["hearts", "diamonds"].includes(card.suit) ? "red" : "black";
export const cardRank = rank => ({1: "A", 11: "J", 12: "Q", 13: "K"})[rank] || String(rank);

export function newSolitaire(random = Math.random) {
  const deck = SUITS.flatMap(suit => Array.from({length: 13}, (_, i) => ({id: `${suit}-${i + 1}`, suit, rank: i + 1, faceUp: false})));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tableau = Array.from({length: 7}, (_, index) => {
    const pile = deck.splice(0, index + 1);
    pile[pile.length - 1] = {...pile[pile.length - 1], faceUp: true};
    return pile;
  });
  return {stock: deck, waste: [], foundations: [[], [], [], []], tableau, moves: 0};
}

export function drawSolitaire(state) {
  if (state.stock.length) {
    const card = state.stock[state.stock.length - 1];
    return {...state, stock: state.stock.slice(0, -1), waste: [...state.waste, {...card, faceUp: true}], moves: state.moves + 1};
  }
  if (!state.waste.length) return state;
  return {...state, stock: [...state.waste].reverse().map(card => ({...card, faceUp: false})), waste: [], moves: state.moves + 1};
}

function pileAt(state, location) {
  if (location?.pile === "waste") return state.waste;
  if (location?.pile === "tableau" && Number.isInteger(location.index)) return state.tableau[location.index];
  if (location?.pile === "foundation" && Number.isInteger(location.index)) return state.foundations[location.index];
  return null;
}

export function moveSolitaire(state, from, to) {
  const source = pileAt(state, from), destination = pileAt(state, to);
  if (!source || !destination || source === destination || !["tableau", "foundation"].includes(to.pile)) return {error: "Choose a different destination pile."};
  const start = from.pile === "tableau" ? from.cardIndex : source.length - 1;
  if (!Number.isInteger(start) || start < 0 || start >= source.length) return {error: "Select a face-up card first."};
  const cards = source.slice(start);
  if (!cards.every(card => card.faceUp)) return {error: "Face-down cards cannot be moved."};
  if (cards.some((card, i) => i && (cards[i - 1].rank !== card.rank + 1 || cardColor(cards[i - 1]) === cardColor(card)))) return {error: "Move only a descending, alternating-color sequence."};
  const top = destination[destination.length - 1];
  if (to.pile === "foundation") {
    if (cards.length !== 1 || cards[0].suit !== SUITS[to.index] || cards[0].rank !== (top?.rank || 0) + 1) {
      return {error: "Foundations build by suit from Ace to King, one card at a time."};
    }
  } else if (top ? !top.faceUp || top.rank !== cards[0].rank + 1 || cardColor(top) === cardColor(cards[0]) : cards[0].rank !== 13) {
    return {error: "Columns build downward in alternating colors. Only a King can fill an empty column."};
  }
  const next = {...state, waste: [...state.waste], tableau: state.tableau.map(pile => [...pile]),
    foundations: state.foundations.map(pile => [...pile]), moves: state.moves + 1};
  const nextSource = pileAt(next, from), nextDestination = pileAt(next, to);
  nextSource.splice(start);
  if (from.pile === "tableau" && nextSource.length && !nextSource[nextSource.length - 1].faceUp) {
    nextSource[nextSource.length - 1] = {...nextSource[nextSource.length - 1], faceUp: true};
  }
  nextDestination.push(...cards);
  return {state: next};
}

export const solitaireWon = state => state.foundations.every(pile => pile.length === 13);
