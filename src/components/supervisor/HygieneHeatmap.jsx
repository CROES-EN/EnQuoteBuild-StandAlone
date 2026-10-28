import {useMemo} from "react";
import {buildHygieneHeatmap} from "@/features/supervisorDashboard/supervisorInsights";

/** Comment author x flag category matrix; darker cells mean more flagged cases. */
export default function HygieneHeatmap({report, selectedAuthor, onSelectAuthor}) {
  const heatmap = useMemo(() => buildHygieneHeatmap(report), [report]);
  if (!heatmap.rows.length) return <p className="text-sm">No authors with detectable intake issues.</p>;
  return <div className="space-y-2" data-hygiene-heatmap>
    <p className="text-xs text-muted-foreground">
      Flagged cases per comment author and flag type (top {heatmap.rows.length} authors by flagged cases). Darker cells repeat more often;
      hover for the share of that author&apos;s requests. Click an author to filter the review below.
    </p>
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="text-left font-medium text-muted-foreground px-1">Comment author</th>
            <th className="font-medium text-muted-foreground px-1">Flagged / requests</th>
            {heatmap.issues.map(issue => <th key={issue} className="font-medium text-muted-foreground px-1 min-w-[84px] align-bottom">{issue}</th>)}
          </tr>
        </thead>
        <tbody>
          {heatmap.rows.map(row => <tr key={row.author}>
            <td className="px-1">
              <button type="button" onClick={() => onSelectAuthor?.(selectedAuthor === row.author ? "all" : row.author)}
                className={`text-left hover:underline ${selectedAuthor === row.author ? "font-semibold text-primary" : ""}`}>{row.author}</button>
            </td>
            <td className="px-1 text-center whitespace-nowrap">{row.flagged} / {row.requests}</td>
            {row.cells.map(cell => {
              const intensity = heatmap.max ? cell.count / heatmap.max : 0;
              return <td key={cell.issue} data-heatmap-count={cell.count}
                title={`${row.author}: ${cell.count} of ${row.requests} requests (${cell.rate}%) - ${cell.issue}`}
                className="rounded text-center font-medium tabular-nums py-1.5"
                style={{backgroundColor: cell.count ? `hsl(var(--primary) / ${(0.12 + intensity * 0.78).toFixed(2)})` : "hsl(var(--secondary))",
                  color: intensity > 0.5 ? "hsl(var(--primary-foreground))" : undefined}}>
                {cell.count || ""}
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}
