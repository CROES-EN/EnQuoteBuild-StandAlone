import {useEffect} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {listLocalCollection, syncFstRoster} from "@/api/dataClient";

const DEFAULT_POLL_MS = 60 * 1000;

// Shared FST roster for any screen. Syncing seeds the bundled roster locally, pulls other
// users' edits and pushes ours; it never throws - offline just means "local only for now".
// Pass pollMs: 0 to sync once on mount instead of on a timer.
export function useFstRoster({ pollMs = DEFAULT_POLL_MS } = {}) {
  const queryClient = useQueryClient();

  const syncRoster = async () => {
    try {
      const result = await syncFstRoster();
      if (result?.changed) queryClient.invalidateQueries({ queryKey: ["fsts"] });
    } catch {
      // Local roster keeps working without the shared sync.
    }
  };

  const { data: fsts = [], isLoading } = useQuery({
    queryKey: ["fsts"],
    queryFn: async () => {
      let list = await listLocalCollection("fsts");
      if (!list || list.length === 0) {
        await syncRoster();
        list = await listLocalCollection("fsts");
      }
      return (list || [])
        .filter((f) => !f.is_deleted)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }
  });

  useEffect(() => {
    syncRoster();
    if (!pollMs) return undefined;
    const timer = setInterval(syncRoster, pollMs);
    return () => clearInterval(timer);
  }, []);

  const afterRosterWrite = () => {
    queryClient.invalidateQueries({ queryKey: ["fsts"] });
    syncRoster();
  };

  return { fsts, activeFSTs: fsts.filter((f) => f.is_active !== false), isLoading, syncRoster, afterRosterWrite };
}
