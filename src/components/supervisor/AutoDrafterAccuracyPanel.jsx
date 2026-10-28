import {Link} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {useAutoDrafterAccuracy} from "@/features/supervisorDashboard/useSupervisorInsights";

function Stat({label, value, detail}) {
  return <div className="rounded-lg border border-border bg-secondary p-3">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-bold">{value}</p>
    {detail && <p className="text-[11px] text-muted-foreground">{detail}</p>}
  </div>;
}

export default function AutoDrafterAccuracyPanel() {
  const query = useAutoDrafterAccuracy();
  const data = query.data;
  return <Card className="border-border" data-auto-drafter-accuracy>
    <CardContent className="p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          All saved Auto-Drafter drafts on this computer (not the dashboard date range). Line-item confidence reflects each draft&apos;s
          current items, after any reviewer swaps. Use the phrase list to decide which catalog items, aliases, or SOP wording to fix.
        </p>
        <Button asChild size="sm" variant="outline"><Link to="/AutoDrafter">Open Auto-Drafter</Link></Button>
      </div>
      {query.isError ? <div role="alert" className="text-sm text-destructive">
        Unable to load Auto-Drafter drafts: {query.error.message} <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </div>
        : query.isLoading ? <p role="status" className="text-sm">Loading Auto-Drafter drafts...</p>
        : !data?.drafts ? <p className="text-sm text-muted-foreground">No Auto-Drafter drafts have been generated yet.</p>
        : <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Sent without edits" value={data.uneditedRate === null ? "-" : `${data.uneditedRate}%`}
              detail={`${data.sentUnedited} of ${data.sent} sent drafts`} />
            <Stat label="Drafts generated" value={data.drafts} detail={`${data.sent} sent to Quotes`} />
            <Stat label="Line items matched" value={data.highRate === null ? "-" : `${data.highRate}%`}
              detail={`${data.confidence.high} high, ${data.confidence.medium} need review, ${data.confidence.low} not in catalog`} />
            <Stat label="Learned swaps" value={data.learnedSwaps} detail="Reviewer-taught item replacements" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">Requested items most often not matched</p>
              {data.topPhrases.length ? <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Requested wording</th><th className="py-1 font-medium text-right">Not in catalog</th>
                  <th className="py-1 font-medium text-right">Needs review</th><th className="py-1 font-medium text-right">Cases</th>
                </tr></thead>
                <tbody>{data.topPhrases.map(phrase => <tr key={phrase.phrase} className="border-t border-border">
                  <td className="py-1 pr-2">{phrase.phrase}</td><td className="py-1 text-right">{phrase.notInCatalog}</td>
                  <td className="py-1 text-right">{phrase.needsReview}</td><td className="py-1 text-right">{phrase.cases}</td>
                </tr>)}</tbody>
              </table> : <p className="text-sm text-muted-foreground">Every draft line item matched the catalog.</p>}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Most recent learned swaps</p>
              {data.recentSwaps.length ? <ul className="space-y-1 text-xs">
                {data.recentSwaps.map(swap => <li key={swap.id} className="border-t border-border pt-1">
                  &ldquo;{swap.phrase}&rdquo; &rarr; <span className="font-medium">{swap.catalogName}</span>
                  <span className="text-muted-foreground">{swap.taughtBy ? ` · ${swap.taughtBy}` : ""}{swap.taughtAt ? ` · ${new Date(swap.taughtAt).toLocaleDateString()}` : ""}</span>
                </li>)}
              </ul> : <p className="text-sm text-muted-foreground">No swaps have been taught yet.</p>}
            </div>
          </div>
        </>}
    </CardContent>
  </Card>;
}
