import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";

export default function InactiveDataError({error, refetch, isFetching}) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <Card role="alert" className="space-y-3 border-destructive/40 p-6">
        <h2 className="text-lg font-semibold text-foreground">Unable to load inactive revenue data</h2>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Report data is unavailable. Try again."}
        </p>
        <p className="text-sm text-muted-foreground">Totals are not shown because the report could not be loaded completely.</p>
        <Button variant="outline" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? "Retrying..." : "Try Again"}
        </Button>
      </Card>
    </div>
  );
}
