import {Link} from "react-router-dom";
import {Grid2x2} from "lucide-react";
import {cn} from "@/lib/utils";

/** Compact marker shown on quote tiles when a PV Panel RMA exists for the case or quote. */
export default function PanelRmaBadge({rma, className}) {
  if (!rma) return null;
  const closed = rma.current_status === "Closed";
  const details = [rma.panel_manufacturer, rma.manufacturer_rma_number && `RMA # ${rma.manufacturer_rma_number}`]
    .filter(Boolean).join(" · ");
  return <Link to="/PVPanelRMAs" data-panel-rma-badge={rma.id} onClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
    title={`PV Panel RMA exists for this case${details ? ` (${details})` : ""}. Open the PV Panel RMA tracker.`}
    className={cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
      closed ? "border-border bg-muted text-muted-foreground" : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
      className)}>
    <Grid2x2 className="h-3 w-3 shrink-0" aria-hidden="true" />
    <span className="truncate">PV RMA · {rma.current_status || "No status"}</span>
  </Link>;
}
