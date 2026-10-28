import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {ChevronDown} from "lucide-react";
import RequestTypeBadge from "./RequestTypeBadge";
import RequestRoutingBadges from "./RequestRoutingBadges";

function issueKey(issue) {
  const text = issue.toLowerCase();
  if (/differs|does not match/.test(text)) {
    if (text.includes("site id")) return "site-id-mismatch";
    if (text.includes("case number")) return "case-number-mismatch";
  }
  return text.trim();
}

function ReviewIssues({issues, compact}) {
  const visible = compact ? issues.slice(0, 2) : issues;
  const remaining = compact ? issues.slice(2) : [];
  const list = values => <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
    {values.map((issue, index) => <li key={index}>{issue}</li>)}
  </ul>;
  return <>
    {list(visible)}
    {remaining.length > 0 && <details onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <summary className="cursor-pointer text-primary mt-1">Show {remaining.length} more {remaining.length === 1 ? "issue" : "issues"}</summary>
      <div className="mt-2">{list(remaining)}</div>
    </details>}
  </>;
}

export default function RequestReviewSummary({
  classification, routingFlags = [], hygiene, sourceWarnings = [], compact = false,
  careError, onRetryCare, onPanelRma, onHygieneReview, onCorrectCategory
}) {
  const hygieneIssues = [...new Map((hygiene?.flags || []).map(issue => [issueKey(issue), issue])).values()]
    .sort((a, b) => Number(/differs|does not match/.test(b)) - Number(/differs|does not match/.test(a)));
  const hygieneKeys = new Set(hygieneIssues.map(issueKey));
  const sourceIssues = [...new Map(sourceWarnings.map(issue => [issueKey(issue), issue])).values()]
    .filter(issue => !hygieneKeys.has(issueKey(issue)));
  const hasCategory = classification && classification.type !== "no_panel";
  const categoryNotes = hasCategory ? classification.reviewNotes || [] : [];
  const hasHygiene = hygieneIssues.length > 0;
  const hasContent = hasCategory || routingFlags.length > 0 || hasHygiene || sourceIssues.length > 0 || careError;
  if (!hasContent && !onPanelRma && !onHygieneReview) return null;
  const content = <>
    {!compact && <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold text-foreground">Request review</h2>
      <div className="flex flex-wrap gap-2">
        {onPanelRma && <Button variant="outline" size="sm" onClick={onPanelRma}>Submit / Edit Panel RMA</Button>}
        {onHygieneReview && <Button variant="outline" size="sm" onClick={onHygieneReview}>Data Hygiene</Button>}
      </div>
    </div>}
    {hasCategory && <div className="space-y-1.5">
      {!compact && <div className="flex flex-wrap items-center gap-2">
        <RequestTypeBadge classification={classification} />
        {classification.learned && classification.learned.matchesAutomatic !== true &&
          <Badge variant="outline" className="text-xs" data-category-learned-badge>Reviewer-taught</Badge>}
      </div>}
      <p className="text-muted-foreground">{classification.reason}</p>
      {onCorrectCategory && <Button variant="link" size="sm" className="h-auto p-0 text-xs" data-correct-category
        onClick={event => {event.stopPropagation(); onCorrectCategory();}}>Wrong category? Correct it</Button>}
      {categoryNotes.length > 0 && <ul aria-label="Category review notes" className="list-disc pl-4 space-y-1 text-amber-700">
        {categoryNotes.map(note => <li key={note}>{note}</li>)}
      </ul>}
    </div>}
    {routingFlags.length > 0 && (compact ? <RequestRoutingBadges flags={routingFlags} showDetails /> : <div className="space-y-2">
      <RequestRoutingBadges flags={routingFlags} />
      <details aria-label="Routing flag explanations">
        <summary className="cursor-pointer text-primary text-xs">Why these routing flags?</summary>
        <div className="mt-3"><RequestRoutingBadges flags={routingFlags} showDetails /></div>
      </details>
    </div>)}
    {hasHygiene && <div className="space-y-1.5">
      <Badge variant="outline" className="text-xs whitespace-normal border-rose-300 text-rose-700">
        Intake review: {hygiene.author} ({hygieneIssues.length} {hygieneIssues.length === 1 ? "flag" : "flags"})
      </Badge>
      <ReviewIssues issues={hygieneIssues} compact />
    </div>}
    {sourceIssues.length > 0 && <div className="space-y-1.5">
      <p className="font-medium text-amber-700">Source / draft checks</p>
      <ReviewIssues issues={sourceIssues} compact />
    </div>}
    {careError && <div role="alert" className="text-destructive">
      Could not verify Care subscriptions: {careError.message}.
      {onRetryCare && <Button variant="link" size="sm" className="px-1 text-destructive" onClick={onRetryCare}>Retry Care verification</Button>}
    </div>}
    {!compact && hasContent && <p className="text-xs text-muted-foreground border-t border-border pt-3">
      These are source-based review flags, not approvals of warranty, RMA eligibility or Care coverage.
    </p>}
  </>;
  if (compact) {
    const issueCount = hygieneIssues.length + sourceIssues.length + categoryNotes.length;
    return <details aria-label="Request review" className="group/review text-xs leading-relaxed"
      onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <summary className="list-none cursor-pointer flex flex-wrap items-center gap-2">
        {hasCategory ? <RequestTypeBadge classification={classification} /> : <span className="font-medium">Request review</span>}
        {issueCount > 0 && <Badge variant="outline" className="text-xs border-rose-300 text-rose-700">
          {issueCount} {issueCount === 1 ? "flag" : "flags"}
        </Badge>}
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          Details <ChevronDown className="w-3.5 h-3.5 transition-transform group-open/review:rotate-180" />
        </span>
      </summary>
      <div className="mt-3 border-t border-border pt-3 space-y-3">{content}</div>
    </details>;
  }
  return <section aria-label="Request review"
    className="mb-6 rounded-xl border border-border bg-card p-4 md:p-5 space-y-4 text-sm leading-relaxed">
    {content}
  </section>;
}
