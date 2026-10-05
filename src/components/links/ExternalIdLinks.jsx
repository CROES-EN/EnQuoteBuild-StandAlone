import {cn} from "@/lib/utils";
import {caseLinkFor, enlightenSiteUrl} from "@/lib/externalLinks";
import {useCaseIdIndex} from "@/features/links/caseIdIndexCache";

const LINK_CLASS = "text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none";

// Links sit inside clickable rows/cards all over the app; don't let a click also open the row.
const stop = (event) => event.stopPropagation();

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
      onClick={stop}
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
