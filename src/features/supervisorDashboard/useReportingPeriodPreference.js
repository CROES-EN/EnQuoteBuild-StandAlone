import {useCallback, useEffect, useState} from "react";
import {toast} from "sonner";
import {onUserSessionChanged} from "@/lib/userScopedStorage";
import {readReportingPeriod, saveReportingPeriod} from "./reportingPeriodPreferences";

export function useReportingPeriodPreference(scope) {
  const [value, setValue] = useState(() => readReportingPeriod(scope));

  useEffect(() => onUserSessionChanged(() => {
    setValue(readReportingPeriod(scope));
  }), [scope]);

  const updateValue = useCallback(next => {
    const resolved = typeof next === "function" ? next(value) : next;
    if (!saveReportingPeriod(scope, resolved)) {
      toast.error("Your reporting period changed, but could not be saved on this device.");
    }
    setValue(resolved);
  }, [scope, value]);

  return [value, updateValue];
}
