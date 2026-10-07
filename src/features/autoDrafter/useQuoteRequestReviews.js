import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useEffect} from "react";
import {appendQuoteRequestReview, listQuoteRequestReviews} from "@/features/supervisorDashboard/importedTableStore";

const KEY = ["quote-request-reviews"];

export function useQuoteRequestReviews() {
  const client = useQueryClient();
  const query = useQuery({queryKey: KEY, queryFn: listQuoteRequestReviews, refetchInterval: 60000});
  useEffect(() => {
    const unsubscribe = globalThis.window?.enquoteLocal?.app?.onDataUpdated?.(() => {
      client.invalidateQueries({queryKey: KEY});
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [client]);
  return {
    ...query,
    save: async record => {
      await appendQuoteRequestReview(record);
      client.setQueryData(KEY, records => [...(records || []), record]);
      await client.invalidateQueries({queryKey: KEY});
    }
  };
}
