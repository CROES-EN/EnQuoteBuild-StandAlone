import {useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {gamesApi, hasOnlineGames} from "./gamesApi";
import MemoryIcon from "./MemoryIcon";
import StrategyBoards from "./StrategyBoards";
import {ONLINE_GAME_NAMES} from "../../../../shared/arcadeGames.js";
import {retroApi} from "../api";
import {loadEnSpaceTeammates} from "./teammates";

const gameName = kind => ONLINE_GAME_NAMES[kind];
const opponentOf = (game, me) => game.challenger === me ? game.opponent : game.challenger;

export default function OnlineArcade({initialKind = "tic"}) {
  const [selected, setSelected] = useState(null);
  const [recipient, setRecipient] = useState("");
  const [kind, setKind] = useState(initialKind);
  const [actionError, setActionError] = useState("");
  const owner = getCurrentUserNamespace();
  const supported = hasOnlineGames();
  const client = useQueryClient();
  const listKey = ["retro-games", owner];
  const unavailable = error => ["not_found", "http_404", "desktop_restart_required"].includes(error?.code);
  const list = useQuery({queryKey: listKey, queryFn: gamesApi.list, enabled: supported,
    retry: (count, error) => !unavailable(error) && count < 2,
    refetchInterval: query => unavailable(query.state.error) ? false : 5000});
  const directory = useQuery({queryKey: ["arcade-teammates", owner],
    queryFn: () => loadEnSpaceTeammates(retroApi.list, owner), enabled: supported, staleTime: 60000});
  const teammates = (directory.data || []).filter(profile => !list.data || list.data.players.includes(profile.email));
  const canChallenge = Boolean(list.data && !list.error && !directory.error &&
    teammates.some(profile => profile.email === recipient));
  const match = useQuery({
    queryKey: ["retro-game", owner, selected], queryFn: () => gamesApi.get(selected),
    enabled: supported && Boolean(selected),
    refetchInterval: query => ["finished", "declined", "cancelled", "expired"].includes(query.state.data?.game?.status)
      ? false : query.state.data?.game?.open?.length === 2 ? 300 : 2000
  });
  const me = list.data?.me || owner;
  const act = useMutation({
    mutationFn: gamesApi.act,
    onSuccess: result => {
      setActionError("");
      client.setQueryData(["retro-game", owner, result.game.id], result);
      setSelected(result.game.id);
      client.invalidateQueries({queryKey: listKey});
    },
    onError: error => {
      setActionError(error.message);
      client.invalidateQueries({queryKey: listKey});
      if (selected) client.invalidateQueries({queryKey: ["retro-game", owner, selected]});
    }
  });
  if (!supported) return <p role="status">Online challenges require the new EnQuote desktop release. You can still play all local games.</p>;
  const game = match.data?.game;
  const send = (action, extra = {}, target = game) => {
    if (!target || act.isPending) return;
    setActionError("");
    act.mutate({id: target.id, version: target.version, action, ...extra});
  };
  const error = actionError || (selected ? match.error?.message : list.error?.message);
  const label = game?.status === "finished"
    ? game.winner === "draw" ? "Draw!" : game.winner === me ? "You win!" : "Your opponent wins!"
    : game?.status === "active" ? game.phase === "setup" ? "Place your fleet" : game.turn === me ? "Your turn" : "Opponent's turn" : game?.status;
  const locked = act.isPending || Boolean(match.error) || game?.status !== "active" || game?.turn !== me || game?.open?.length === 2;
  return <div className="space-y-4">
    <p>Challenge a teammate. Every accepted move and ship placement is saved online. Close Games or EnQuote and resume from Open match later. Active matches do not expire; unanswered invitations expire after 24 hours.</p>
    {error && <div role="alert" className="enspace-online-error p-3">
      {error} <button type="button" className="underline" onClick={() => {setActionError(""); void (selected ? match.refetch() : list.refetch());}}>Refresh</button>
    </div>}
    {!selected && directory.error && <div role="alert" className="enspace-online-error p-3">
      {directory.error.message} <button type="button" className="underline" onClick={() => void directory.refetch()}>Refresh teammates</button>
    </div>}
    {selected ? <>
      <button type="button" className="enspace-arcade-action" onClick={() => {setSelected(null); setActionError("");}}>Back to challenges</button>
      {match.isLoading && <p role="status">Loading match...</p>}
      {game && <>
        <h4 className="font-bold">{gameName(game.kind)} vs {opponentOf(game, me)}</h4>
        <p className="enspace-score" role="status" aria-live="polite">{label}{game.resignedBy ? " (resigned)" : ""}</p>
        {game.status === "active" && <p role="status">{act.isPending ? "Saving... Wait for confirmation before closing." : actionError ? "Action not confirmed. Refresh before retrying." : "Latest match state loaded from the server."}</p>}
        {game.status === "pending" && <div className="flex gap-2">
          {game.opponent === me ? <>
            <button className="enspace-arcade-action" disabled={act.isPending} onClick={() => send("accept")}>Accept</button>
            <button className="enspace-arcade-action" disabled={act.isPending} onClick={() => send("decline")}>Decline</button>
          </> : <button className="enspace-arcade-action" disabled={act.isPending} onClick={() => send("cancel")}>Cancel invitation</button>}
        </div>}
        {["active", "finished"].includes(game.status) && (game.kind === "tic" ? <>
          <p>You are {game.challenger === me ? "X" : "O"}.</p>
          <div className="grid max-w-xs grid-cols-3 gap-2">
            {game.board.map((value, index) => <button key={index} type="button" disabled={locked || Boolean(value)}
              aria-label={`Online row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}: ${value || "empty"}`}
              className={`enspace-tic-cell aspect-square text-3xl font-bold ${value === "O" ? "is-computer" : ""}`}
              onClick={() => send("move", {index})}>{value}</button>)}
          </div>
        </> : game.kind !== "memory" ? <StrategyBoards key={game.id} game={game} me={me} locked={locked} pending={act.isPending} send={send} /> : <>
          <p>Pairs: You {game.scores[me] || 0} / Opponent {game.scores[opponentOf(game, me)] || 0}. A match earns another turn; a miss passes the turn.</p>
          <div className="grid max-w-md grid-cols-4 gap-2">
            {game.cards.map((symbol, index) => <button key={index} type="button"
              disabled={locked || game.matched.includes(index) || game.open.includes(index)}
              aria-label={`Online card ${index + 1}: ${symbol || "face down"}${game.matched.includes(index) ? ", matched" : ""}`}
              className={`enspace-memory-card aspect-square ${symbol ? "is-revealed" : ""} ${game.matched.includes(index) ? "is-matched" : ""}`}
              onClick={() => send("move", {index})}>{symbol ? <MemoryIcon symbol={symbol} /> : "?"}</button>)}
          </div>
        </>)}
        {game.status === "active" && <details><summary className="cursor-pointer">End match</summary>
          <p>Resigning awards the match to your opponent.</p>
          <button className="enspace-arcade-action" disabled={act.isPending} onClick={() => send("resign")}>Resign match</button>
        </details>}
      </>}
    </> : <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        if (!canChallenge || act.isPending) return;
        setActionError("");
        act.mutate({action: "challenge", id: crypto.randomUUID(), to: recipient, kind});
      }}>
        <label>Teammate<select className="enspace-arcade-select block" value={recipient} onChange={event => setRecipient(event.target.value)}>
          <option value="">Choose teammate</option>
          {teammates.map(profile => <option key={profile.email} value={profile.email}>{profile.name} ({profile.email})</option>)}
        </select></label>
        <label>Game<select className="enspace-arcade-select block" value={kind} onChange={event => setKind(event.target.value)}>
          {Object.entries(ONLINE_GAME_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <button type="submit" className="enspace-arcade-action" disabled={!canChallenge || act.isPending}>Send challenge</button>
      </form>
      {directory.isLoading ? <p role="status">Loading EnSpace teammates...</p> :
        !directory.error && teammates.length === 0 && <p>No other published EnSpace profiles are available. Teammates must publish their EnSpace first.</p>}
      <h4 className="font-bold">Your challenges and matches</h4>
      {list.isLoading && <p role="status">Loading challenges...</p>}
      {list.data?.games.length === 0 && <p>No challenges yet.</p>}
      <ul className="space-y-2">
        {(list.data?.games || []).map(item => <li key={item.id} className="enspace-arcade-cabinet flex flex-wrap gap-2 p-3">
          <span>{gameName(item.kind)} vs {opponentOf(item, me)} - {item.status}
            {item.status === "pending" && item.opponent === me ? " (invited you)" : ""}</span>
          <button type="button" className="enspace-arcade-action" onClick={() => {setSelected(item.id); setActionError("");}}>Open match</button>
        </li>)}
      </ul>
    </>}
  </div>;
}
