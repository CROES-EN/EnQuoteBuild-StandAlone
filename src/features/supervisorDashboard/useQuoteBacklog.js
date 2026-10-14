import {useQuery} from "@tanstack/react-query";

export function useQuoteBacklog(date) {
  return useQuery({
    queryKey: ["quote-backlog-daily", date],
    enabled: Boolean(date),
    queryFn: async () => {
      const get = window.enquoteLocal?.quoteBacklog?.get;
      if (typeof get !== "function") throw new Error("Restart after installing the desktop update to load shared backlog history.");
      const unavailableMessage = "Shared Quote Backlog is not enabled on the sync server yet. Deploy the backlog service and database migration, then retry.";
      let result;
      try {
        result = await get(date);
      } catch (error) {
        if (error?.code === "not_found" || error?.code === "http_404" ||
            /\b(?:not_found|http_404)\b/.test(error?.message || "")) {
          throw new Error(unavailableMessage);
        }
        throw error;
      }
      if (!result?.ok) throw new Error(["not_found", "http_404"].includes(result?.error)
        ? unavailableMessage : result?.error || "Could not load shared quote backlog.");
      if (typeof result.live !== "boolean" || !Object.hasOwn(result, "snapshot")) throw new Error("The backlog response is invalid.");
      const snapshot = result.snapshot;
      if (snapshot === null) {
        if (result.live) throw new Error("The backlog snapshot is invalid.");
        return result;
      }
      if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.rows) || !Number.isInteger(snapshot.count) || snapshot.count < 0 ||
          snapshot.rows.length !== snapshot.count || snapshot.date !== date ||
          snapshot.timeZone !== "America/Denver" || !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
          !snapshot.statusCounts || typeof snapshot.statusCounts !== "object" || Array.isArray(snapshot.statusCounts) ||
          Object.values(snapshot.statusCounts).some(value => !Number.isInteger(value) || value < 0) ||
          Object.values(snapshot.statusCounts).reduce((sum, value) => sum + value, 0) !== snapshot.count ||
          snapshot.rows.some(row => typeof row?.quote?.id !== "string" || typeof row?.quote?.status !== "string" || !row?.alert ||
            !Number.isFinite(row.alert.overdueHours) || row.alert.overdueHours < 0)) {
        throw new Error("The backlog snapshot is invalid.");
      }
      return result;
    },
    refetchInterval: query => query.state.data?.live ? 60000 : false
  });
}
