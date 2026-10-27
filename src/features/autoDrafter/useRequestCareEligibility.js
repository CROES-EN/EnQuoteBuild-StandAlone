import {useEffect} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import {buildCareEligibilityIndex} from "@/features/supervisorDashboard/careEligibility";

const KEY = ["care-request-routing"];

export function useRequestCareEligibility() {
  const client = useQueryClient();
  const query = useQuery({
    // Imports and remote updates refresh this immediately (onDataUpdated / page mount); the
    // timer is only a safety net, so it runs rarely to avoid re-indexing a large report.
    queryKey: KEY, refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const table = await getReportTable("care_subscriptions");
      if (!table) return null;
      if (!Array.isArray(table.rows) || !Array.isArray(table.columns) ||
          !["Enlighten Site Id", "Subscription Status"].every(column => table.columns.includes(column))) {
        throw new Error("The Care subscription report is missing required data. Reimport it to verify routing.");
      }
      return buildCareEligibilityIndex(table.rows);
    }
  });
  useEffect(() => {
    const unsubscribe = globalThis.window?.enquoteLocal?.app?.onDataUpdated?.(() => client.invalidateQueries({queryKey: KEY}));
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [client]);
  return query;
}
