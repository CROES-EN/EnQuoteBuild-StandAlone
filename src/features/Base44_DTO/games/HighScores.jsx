import {useEffect, useRef, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {SCORE_GAMES} from "../../../../shared/arcadeScores.js";
import {gamesApi, hasSharedScores} from "./gamesApi";
import {readPersonalScores, recordPersonalScore} from "./personalScores";

function initialPersonalScores() {
  try {return {scores: readPersonalScores(), error: ""};}
  catch (error) {
    console.warn("[arcade-scores] Could not read personal bests:", error.message);
    return {scores: {}, error: `Could not read personal bests: ${error.message}`};
  }
}

export function useGameHighScore(kind, value, runId) {
  const [personal, setPersonal] = useState(initialPersonalScores);
  const [completed, setCompleted] = useState(null);
  const submitted = useRef(null);
  const owner = getCurrentUserNamespace();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: gamesApi.score,
    onSuccess: result => {
      if (getCurrentUserNamespace() !== owner) return;
      try {
        const best = recordPersonalScore(kind, result.best);
        setPersonal(current => ({scores: {...current.scores, [kind]: best}, error: ""}));
      } catch (error) {
        console.warn("[arcade-scores] Shared best saved, but personal storage failed:", error.message);
        setPersonal(current => ({...current, error: `Shared best saved, but local storage failed: ${error.message}`}));
      }
      client.invalidateQueries({queryKey: ["retro-scores", owner]});
    }
  });
  const {mutate, reset} = save;
  useEffect(() => {
    setCompleted(null);
    reset();
  }, [runId, reset]);
  useEffect(() => {
    if (value === null || submitted.current === runId) return;
    submitted.current = runId;
    let uploadValue = value;
    try {
      const best = recordPersonalScore(kind, value);
      uploadValue = best;
      setPersonal(current => ({scores: {...current.scores, [kind]: best}, error: ""}));
    } catch (error) {
      console.warn("[arcade-scores] Could not save personal best:", error.message);
      setPersonal(current => ({...current, error: `Could not save personal best: ${error.message}`}));
    }
    setCompleted(uploadValue);
    if (hasSharedScores()) mutate({kind, value: uploadValue, completed: true});
  }, [value, runId, kind, mutate]);
  return <div className="text-sm">
    <p>Personal best: {personal.scores[kind] ?? "--"}{SCORE_GAMES[kind].direction === "lowest" ? " moves" : " points"}</p>
    {personal.error && <p role="alert">{personal.error}</p>}
    {save.isPending && <p role="status">Saving shared high score...</p>}
    {completed !== null && save.isSuccess && <p role="status">Shared leaderboard updated.</p>}
    {save.error && <p role="alert">Shared score not saved: {save.error.message}{" "}
      <button className="underline" onClick={() => save.mutate({kind, value: completed, completed: true})}>Retry score upload</button>
    </p>}
  </div>;
}

export default function HighScores() {
  const owner = getCurrentUserNamespace();
  const [personal] = useState(initialPersonalScores);
  const client = useQueryClient();
  const shared = useQuery({queryKey: ["retro-scores", owner], queryFn: gamesApi.scores, enabled: hasSharedScores(), refetchInterval: 30000});
  const sync = useMutation({
    mutationFn: () => Promise.all(Object.entries(readPersonalScores()).map(([kind, value]) => gamesApi.score({kind, value, completed: true}))),
    onSuccess: () => client.invalidateQueries({queryKey: ["retro-scores", owner]})
  });
  return <section aria-label="Arcade high scores" className="space-y-3">
    <h3 className="text-lg font-bold">High scores</h3>
    <p>Snake: highest score. Memory Match and Solitaire: fewest moves in a completed game. Local results are honor-system scores, not cheat-proof rankings.</p>
    {personal.error && <p role="alert">{personal.error}</p>}
    {!hasSharedScores() && <p>Shared leaderboards require the new desktop release. Personal bests still save on this PC.</p>}
    {hasSharedScores() && <button type="button" className="enspace-arcade-action" disabled={sync.isPending || !Object.keys(personal.scores).length} onClick={() => sync.mutate()}>Sync personal bests</button>}
    {sync.error && <p role="alert">Could not sync personal bests: {sync.error.message}</p>}
    {sync.isSuccess && <p role="status">Personal bests synced.</p>}
    {shared.isLoading && <p role="status">Loading shared high scores...</p>}
    {shared.error && <p role="alert">{shared.error.message}{" "}<button className="underline" onClick={() => void shared.refetch()}>Retry leaderboard</button></p>}
    <div className="grid gap-3 sm:grid-cols-3">
      {Object.entries(SCORE_GAMES).map(([kind, game]) => <div key={kind} className="enspace-arcade-cabinet space-y-2 p-3">
        <h4 className="font-bold">{game.name}</h4>
        <p>Your shared best: {shared.data?.personal[kind] ?? "--"}</p>
        <p>This PC: {personal.scores[kind] ?? "--"}</p>
        <ol className="list-inside list-decimal space-y-1">
          {(shared.data?.boards[kind] || []).map(row => <li key={row.email} className="break-words">{row.email}: {row.value}</li>)}
        </ol>
        {shared.data?.boards[kind]?.length === 0 && <p>No completed scores yet.</p>}
      </div>)}
    </div>
  </section>;
}
