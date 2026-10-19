import {useCallback, useEffect, useRef, useState} from "react";
import {pageViewKey, readPageView, writePageView} from "@/lib/pageViewState";
import {onUserSessionChanged} from "@/lib/userScopedStorage";

export function usePageViewState(page, field, initialValue, {persist = true} = {}) {
  const initial = useRef();
  if (!initial.current) initial.current = {value: typeof initialValue === "function" ? initialValue() : initialValue};
  const fallback = initial.current.value;
  const key = pageViewKey(page, field);
  const [entry, setEntry] = useState(() => ({key, value: readPageView(key, fallback)}));
  if (entry.key !== key) setEntry({key, value: readPageView(key, fallback)});

  useEffect(() => onUserSessionChanged(() => {
    const nextKey = pageViewKey(page, field);
    setEntry({key: nextKey, value: readPageView(nextKey, fallback)});
  }), [page, field, fallback]);

  useEffect(() => {
    if (persist && entry.key === key) writePageView(key, entry.value);
  }, [entry, key, persist]);

  const setValue = useCallback(value => {
    setEntry(previous => {
      const current = previous.key === key ? previous.value : readPageView(key, fallback);
      return {key, value: typeof value === "function" ? value(current) : value};
    });
  }, [key, fallback]);
  return [entry.key === key ? entry.value : readPageView(key, fallback), setValue];
}
