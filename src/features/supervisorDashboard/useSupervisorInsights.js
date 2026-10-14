import {useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {listLocalCollection} from "@/api/dataClient";
import {listGeneratedDrafts} from "@/features/autoDrafter/autoDrafterDraftsStore";
import {listLearnedSwaps} from "@/features/quoteDraftAgent/learnedSwapsStore";
import {
    addDays,
    buildAutoDrafterAccuracy,
    buildBacklogFlow,
    buildPanelRmaCycleMetrics
} from "@/features/supervisorDashboard/supervisorInsights";

export const BACKLOG_FLOW_DAYS = 14;

/** Daily Quote Backlog flow for the days ending at endDate, from the shared daily snapshots. */
export function useBacklogFlow(endDate, days = BACKLOG_FLOW_DAYS) {
  return useQuery({
    queryKey: ["quote-backlog-flow", endDate, days],
    enabled: Boolean(endDate),
    queryFn: async () => {
      const get = window.enquoteLocal?.quoteBacklog?.get;
      if (typeof get !== "function") throw new Error("Restart after installing the desktop update to load shared backlog history.");
      // One extra day so the first displayed day has an opening backlog.
      const dates = Array.from({length: days + 1}, (_, index) => addDays(endDate, index - days));
      const results = await Promise.all(dates.map(async date => {
        const result = await get(date);
        if (!result?.ok) throw new Error(result?.error || "Could not load shared quote backlog.");
        return {date, snapshot: result.snapshot && Array.isArray(result.snapshot.rows) ? result.snapshot : null};
      }));
      return buildBacklogFlow(results).filter(row => row.date >= dates[1]);
    },
    staleTime: 60000
  });
}

export function useAutoDrafterAccuracy() {
  return useQuery({
    queryKey: ["auto-drafter-accuracy"],
    queryFn: async () => {
      const [drafts, swaps] = await Promise.all([listGeneratedDrafts(), listLearnedSwaps()]);
      return buildAutoDrafterAccuracy(drafts, swaps);
    },
    refetchInterval: 60000
  });
}

export function usePanelRmaCycle() {
  const query = useQuery({queryKey: ["pvPanelRMAs"], queryFn: () => listLocalCollection("rmas")});
  const metrics = useMemo(() => query.data ? buildPanelRmaCycleMetrics(query.data) : null, [query.data]);
  return {...query, metrics};
}
