import {cn} from "@/lib/utils";
import {caseLinkFor, enlightenSiteUrl} from "@/lib/externalLinks";
import {useCaseIdIndex} from "@/features/links/caseIdIndexCache";
import {toast} from "sonner";
import {readAppPreferences} from "@/lib/appPreferences";

const LINK_CLASS = "text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none";

// Links sit inside clickable rows/cards all over the app; don't let a click also open the row.
const stop = (event) => event.stopPropagation();

async function openCase(event, url) {
  event.stopPropagation();
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const bridge = globalThis.window?.enquoteLocal?.salesforce;
  if (!bridge?.openWorkspace || readAppPreferences().salesforceMode !== "workspace") return;
  event.preventDefault();
  try {
    const result = await bridge.openWorkspace(url);
    if (!result?.ok) throw new Error(result?.error || "Could not open the Salesforce workspace.");
  } catch (error) {
    toast.error(error?.message || "Could not open the Salesforce workspace.");
  }
}

/**
 * A Salesforce case number rendered as a link. Pass `caseId` when the record has it; otherwise the
 * Case ID is looked up from the Workload report, falling back to a Salesforce search.
 * Renders `fallback` when there is no case number.
 */
export function CaseNumberLink({ caseNumber, caseId, className, children, fallback = null, title }) {
  const index = useCaseIdIndex();
  const text = children ?? caseNumber;
  if (caseNumber === null || caseNumber === undefined || String(caseNumber).trim() === "") return fallback;
  const link = caseLinkFor(caseNumber, { caseId, index });
  if (!link) return <span className={className}>{text}</span>;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => openCase(event, link.url)}
      title={title ?? (link.exact ? "Open case in Salesforce" : "Search Salesforce for this case")}
      className={cn(LINK_CLASS, className)}
    >
      {text}
    </a>
  );
}

/** An Enlighten site id rendered as a link to the Enlighten admin site page. */
export function SiteIdLink({ siteId, className, children, fallback = null, title = "Open site in Enlighten" }) {
  const text = children ?? siteId;
  if (siteId === null || siteId === undefined || String(siteId).trim() === "") return fallback;
  const url = enlightenSiteUrl(siteId);
  if (!url) return <span className={className}>{text}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={stop} title={title} className={cn(LINK_CLASS, className)}>
      {text}
    </a>
  );
}
