import {useEffect, useMemo, useRef, useState} from "react";
import {getQuoteById, getQuotes} from "@/api/dataClient";
import {generateCustomerQuoteDocument} from "@/components/quotes/QuotePDFGenerator";
import {useAuth} from "@/lib/AuthContext";
import {matchSalesforceQuotes} from "@/features/quotes/salesforceQuoteMatch";
import {cleanFilenamePart, quoteHomeownerName} from "../../shared/customerQuoteFilename.js";
import {homeownerQuoteEmail} from "@/features/quotes/homeownerQuoteEmail";

const contextKey = context => JSON.stringify([context.caseNumber, context.siteId, context.contactName]);

export function useSalesforceAutoQuote({visible, loading}) {
  const [state, setState] = useState({message: "", contextKey: "", candidate: null});
  const [busy, setBusy] = useState(false);
  const [nameOverride, setNameOverride] = useState(null);
  const bridge = useMemo(() => window.enquoteLocal?.salesforce, []);
  const {user} = useAuth();
  const active = useRef({key: "", generation: 0});
  const generating = useRef(false);

  useEffect(() => {
    if (!visible || !bridge?.attachment || !bridge?.workspaceAction) return;
    let stopped = false, timer, observed = "", handled = "", invalidCleared = false;
    const invalidate = () => {
      active.current = {key: "", generation: active.current.generation + 1};
      setNameOverride(null);
    };
    const update = (message, candidate = null) => {
      if (!stopped) setState({message, contextKey: observed, candidate});
    };
    async function clear() {
      const result = await bridge.attachment("clear");
      if (!result?.ok) throw new Error(result?.error || "Could not clear the previous quote PDF.");
    }
    if (loading) {
      invalidate();
      update("Waiting for Salesforce...");
      clear().catch(error => update(error.message));
      return () => {stopped = true;};
    }
    const isCurrent = (key, generation) => !stopped && active.current.key === key && active.current.generation === generation;
    async function detect(context, key, generation) {
      try {
        const match = matchSalesforceQuotes(await getQuotes(), context);
        if (!isCurrent(key, generation)) return;
        if (match.matches.length !== 1) {
          update(match.message);
          return;
        }
        const quote = await getQuoteById(match.matches[0].id);
        if (!isCurrent(key, generation)) return;
        if (!quote || matchSalesforceQuotes([quote], context).matches.length !== 1) {
          throw new Error("The matching quote changed. Switch back to this case to scan again.");
        }
        const name = cleanFilenamePart(context.contactName) ? context.contactName : quoteHomeownerName(quote);
        update(`Quote ${quote.quote_number || quote.site_id || ""} matched by ${match.matchedBy === "site" ? "Site ID" : "case number"}.`,
          {quote, context, name, key, generation});
      } catch (error) {
        if (isCurrent(key, generation)) update(error?.message || "Could not find a quote for this case.");
      }
    }
    async function scan() {
      try {
        const result = await bridge.workspaceAction("scan");
        if (stopped) return;
        if (!result?.ok) {
          invalidate();
          update(result?.error || "Open a Salesforce case to scan for a quote.");
          if (!invalidCleared || observed || handled) {
            await clear();
            if (stopped) return;
            invalidCleared = true;
          }
          observed = "";
          handled = "";
          return;
        }
        invalidCleared = false;
        const context = result.context;
        const key = contextKey(context);
        if (key !== observed) {
          invalidate();
          observed = key;
          update(`Scanning case ${context.caseNumber}...`);
          await clear();
          if (stopped) return;
          handled = "";
          active.current.key = key;
          return;
        }
        if (handled === key) return;
        handled = key;
        update(`Finding quote for case ${context.caseNumber}...`);
        void detect(context, key, active.current.generation);
      } catch (error) {
        invalidate();
        observed = "";
        handled = "";
        update(error?.message || "Could not scan Salesforce.");
      } finally {
        if (!stopped) timer = setTimeout(scan, 1000);
      }
    }
    scan();
    return () => {
      stopped = true;
      clearTimeout(timer);
      active.current = {key: "", generation: active.current.generation + 1};
    };
  }, [visible, loading, bridge]);

  const selectedName = nameOverride ?? state.candidate?.name ?? "";
  async function generate() {
    const candidate = state.candidate;
    if (!candidate) throw new Error("Wait for a unique matching quote before generating.");
    if (generating.current) throw new Error("Quote generation is already running.");
    generating.current = true;
    setBusy(true);
    const current = () => active.current.key === candidate.key && active.current.generation === candidate.generation;
    try {
      if (!cleanFilenamePart(selectedName)) throw new Error("Enter a homeowner name in Prepare Homeowner Quote.");
      async function verify() {
        if (!current()) throw new Error("The Salesforce case changed. Generate the quote for the active case instead.");
        const result = await bridge.workspaceAction("scan");
        if (!result?.ok) throw new Error(result?.error || "Could not verify the Salesforce case.");
        if (!current() || contextKey(result.context) !== candidate.key) {
          throw new Error("The Salesforce case changed. Generate the quote for the active case instead.");
        }
      }
      await verify();
      const match = matchSalesforceQuotes(await getQuotes(), candidate.context);
      if (match.matches.length !== 1 || String(match.matches[0].id) !== String(candidate.quote.id)) {
        throw new Error("The matching quotes changed. Reopen the case to scan again.");
      }
      const quote = await getQuoteById(candidate.quote.id);
      if (!quote || matchSalesforceQuotes([quote], candidate.context).matches.length !== 1) {
        throw new Error("The quote's case or site changed. Reopen the case to scan again.");
      }
      await verify();
      const {pdf, scopeSummary} = await generateCustomerQuoteDocument(quote);
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      await verify();
      const result = await bridge.attachment("prepare", {
        name: selectedName, reference: quote.quote_number || quote.site_id || "", bytes, context: candidate.context,
        emailText: homeownerQuoteEmail(quote, selectedName, candidate.context, {
          senderName: user?.display_name || user?.full_name || user?.name || "", scopeSummary
        })
      });
      if (!result?.ok) throw new Error(result?.error || "Could not generate the quote PDF.");
      if (current()) setState(previous => ({...previous, message: "PDF and homeowner email ready. Verify before attaching."}));
    } finally {
      generating.current = false;
      setBusy(false);
    }
  }

  const needsName = Boolean(state.candidate && !cleanFilenamePart(selectedName));
  const disabledReason = busy ? "Quote generation is already running."
    : !visible ? "Open the Salesforce panel to generate a quote."
      : loading ? "Waiting for Salesforce to finish loading."
        : !state.candidate || active.current.key !== state.candidate.key ||
          active.current.generation !== state.candidate.generation ? "Waiting for the active case's quote to be detected."
          : "";
  return {...state, selectedName, setNameOverride, generate, busy, needsName, disabledReason,
    canGenerate: !disabledReason};
}
