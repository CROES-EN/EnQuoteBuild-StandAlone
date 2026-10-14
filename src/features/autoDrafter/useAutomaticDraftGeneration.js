import {useEffect, useMemo, useRef, useState} from "react";
import {runAutomaticDraftBatch} from "@/features/autoDrafter/automaticDraftGeneration";
import {listGeneratedDrafts, createGeneratedDraftIfMissing} from "@/features/autoDrafter/autoDrafterDraftsStore";
import {generateQuoteDraft} from "@/features/quoteDraftAgent/draftEngine";

export function useAutomaticDraftGeneration({candidates, enabled, ownerEmail, onSaved}) {
  const [state, setState] = useState({busy: false, created: 0, skipped: [], errors: []});
  const [retry, setRetry] = useState(0);
  const queue = useRef(Promise.resolve());
  const savedCallback = useRef(onSaved);
  const cancelCurrent = useRef(() => {});
  savedCallback.current = onSaved;
  const signature = useMemo(() => JSON.stringify(candidates), [candidates]);
  useEffect(() => {
    let cancelled = false;
    cancelCurrent.current = () => {cancelled = true;};
    const previous = queue.current;
    queue.current = (async () => {
      await previous;
      if (cancelled) return;
      if (!enabled) {
        setState(previousState => ({...previousState, busy: false}));
        return;
      }
      setState({busy: true, created: 0, skipped: [], errors: []});
      try {
        const result = await runAutomaticDraftBatch(JSON.parse(signature), {
          listSaved: listGeneratedDrafts, buildDraft: generateQuoteDraft,
          createIfMissing: createGeneratedDraftIfMissing, isCancelled: () => cancelled,
          onSaved: record => {if (!cancelled) savedCallback.current(record);},
          onProgress: progress => {if (!cancelled) setState({...progress, skipped: [...progress.skipped], errors: [...progress.errors], busy: true});}
        });
        if (!cancelled) setState({...result, busy: false});
      } catch (error) {
        console.error("Automatic draft generation could not start:", error);
        if (!cancelled) setState({busy: false, created: 0, skipped: [], errors: [{caseNumber: "Batch", reason: error.message}]});
      }
    })();
    return () => {cancelled = true;};
  }, [signature, enabled, ownerEmail, retry]);
  return {...state, retry: () => setRetry(value => value + 1), stop: () => {
    cancelCurrent.current();
    return queue.current;
  }};
}
