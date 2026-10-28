import {ExternalLink} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import sharePoint from "../../../shared/refundSharePoint.json";

export default function RefundBrowserAccess({submission = false}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {submission ? "Submit a request in Microsoft Forms" : "Shared SharePoint refund tracker"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          {submission
            ? "Use the existing Microsoft Form in your browser. Sign in with your work Microsoft account if prompted."
            : "View and process shared refund records in SharePoint using your existing Microsoft permissions. Refresh the SharePoint page to see other users' changes."}
        </p>
        {!sharePoint.browser.formsIntakeEnabled && (
          <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="font-medium">Forms-to-tracker automation is not activated</p>
            <p className="mt-1">
              A Form submission is recorded in Microsoft Forms but will not automatically appear
              in this SharePoint tracker while intake is off. Do not assume it has reached the processing queue.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a
              href={submission ? sharePoint.browser.formResponseUrl : sharePoint.browser.trackerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink aria-hidden="true" />
              {submission ? "Open Microsoft request form" : "Open SharePoint refund tracker"}
              <span className="sr-only"> (opens in your browser)</span>
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={submission ? sharePoint.browser.trackerUrl : sharePoint.browser.formResponseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {submission ? "Open SharePoint refund tracker" : "Open Microsoft request form"}
              <span className="sr-only"> (opens in your browser)</span>
            </a>
          </Button>
        </div>
        <div className="border-t pt-3 text-muted-foreground">
          <p className="font-medium text-foreground">Native EnQuote sync: awaiting IT setup and integration</p>
          <p className="mt-1">
            These links open Microsoft pages; they do not synchronize records into EnQuote.
            Native submissions, the local refund queue, and Excel writeback remain disabled.
            No payments or subscription cancellations are performed automatically.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
