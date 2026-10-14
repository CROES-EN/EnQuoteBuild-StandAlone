import {useEffect} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {getReportTable} from "@/features/supervisorDashboard/importedTableStore";
import {listHygieneHistory, recordHygieneSnapshot} from "@/features/supervisorDashboard/hygieneHistoryStore";

export const HYGIENE_QUERY_KEY = ["quote-request-hygiene-report"];
export const HYGIENE_HISTORY_QUERY_KEY = ["quote-request-hygiene-history"];

export function useQuoteRequestHygieneHistory() {
  return useQuery({queryKey: HYGIENE_HISTORY_QUERY_KEY, queryFn: listHygieneHistory});
}

export function useQuoteRequestHygieneReport() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: HYGIENE_QUERY_KEY,
    queryFn: async () => {
      const table = await getReportTable("quoteRequestCases");
      if (table && (!Array.isArray(table.columns) || table.columns.some(column => typeof column !== "string") ||
          !Array.isArray(table.rows) || table.rows.some(row => !row || typeof row !== "object" || Array.isArray(row)))) {
        throw new Error("The imported quote request report is invalid. Reimport a valid report.");
      }
      return table;
    },
    refetchInterval: 60000
  });
  useEffect(() => {
    if (!query.data) return;
    recordHygieneSnapshot(query.data)
      .then(written => { if (written) client.invalidateQueries({queryKey: HYGIENE_HISTORY_QUERY_KEY}); })
      .catch(error => console.error("Failed to record the daily Data Hygiene summary:", error));
  }, [query.data, client]);
  useEffect(() => {
    const unsubscribe = globalThis.window?.enquoteLocal?.app?.onDataUpdated?.(() => client.invalidateQueries({queryKey: HYGIENE_QUERY_KEY}));
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [client]);
  return query;
}
