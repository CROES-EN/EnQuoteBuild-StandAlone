import {useEffect, useState} from "react";
import {APP_PREFERENCES_CHANGED, readAppPreferences} from "@/lib/appPreferences";
import {onUserSessionChanged} from "@/lib/userScopedStorage";

export function useAppPreferences() {
  const [preferences, setPreferences] = useState(readAppPreferences);
  useEffect(() => {
    const reload = () => setPreferences(readAppPreferences());
    const unsubscribe = onUserSessionChanged(reload);
    window.addEventListener(APP_PREFERENCES_CHANGED, reload);
    window.addEventListener("storage", reload);
    return () => {
      unsubscribe();
      window.removeEventListener(APP_PREFERENCES_CHANGED, reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  return preferences;
}
