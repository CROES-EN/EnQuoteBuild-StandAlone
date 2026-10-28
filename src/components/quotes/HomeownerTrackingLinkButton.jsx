import {useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {Copy, Link2, Link2Off} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    createTrackingLink,
    getTrackingLink,
    hasTrackingLinkBridge,
    revokeTrackingLink,
    trackingQuoteId
} from "@/features/quotes/trackingLink";

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

export default function HomeownerTrackingLinkButton({quote}) {
  const [open, setOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const queryClient = useQueryClient();
  const quoteId = trackingQuoteId(quote);
  const queryKey = ["trackingLink", quoteId];
  const linkQuery = useQuery({
    queryKey, queryFn: () => getTrackingLink(quoteId),
    enabled: open && Boolean(quoteId), staleTime: 30_000, retry: false
  });
  const createMutation = useMutation({
    mutationFn: () => createTrackingLink(quoteId),
    onSuccess: async link => {
      queryClient.setQueryData(queryKey, link);
      try {
        await copyText(link.url);
        toast.success("Tracking link copied. Paste it into your email to the homeowner.");
      } catch {
        toast.success("Tracking link created. Copy it from the box below.");
      }
    },
    onError: error => toast.error(error.message)
  });
  const revokeMutation = useMutation({
    mutationFn: () => revokeTrackingLink(quoteId),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, null);
      setConfirmRevoke(false);
      toast.success("Tracking link turned off. The old link no longer works.");
    },
    onError: error => toast.error(error.message)
  });

  if (!hasTrackingLinkBridge()) return null;
  const link = linkQuery.data;
  const missingSiteId = !String(quote?.site_id || "").trim();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="border-orange-200 text-orange-700 hover:bg-orange-50">
        <Link2 className="w-4 h-4 mr-2" />
        Homeowner Link
      </Button>
      <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setConfirmRevoke(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Homeowner tracking link</DialogTitle>
            <DialogDescription>
              A read-only page where the homeowner can follow this quote&apos;s progress. They must enter the site ID
              to open it, and they only see the status, dates, quote number and next step &mdash; never prices, notes or names.
            </DialogDescription>
          </DialogHeader>
          {!quoteId ? (
            <p className="text-sm text-muted-foreground">This quote hasn&apos;t synced yet. Try again once it has been saved to the shared service.</p>
          ) : missingSiteId ? (
            <p className="text-sm text-amber-700">Add a site ID to this quote first. Homeowners enter it to open the link.</p>
          ) : linkQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking for an existing link…</p>
          ) : linkQuery.isError ? (
            <p className="text-sm text-rose-600">{linkQuery.error.message}</p>
          ) : link ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input readOnly value={link.url} onFocus={event => event.target.select()} aria-label="Tracking link" />
                <Button variant="outline" onClick={() => copyText(link.url).then(
                  () => toast.success("Tracking link copied."),
                  () => toast.error("Couldn't copy. Select the link and copy it manually.")
                )}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Created {new Date(link.createdAt).toLocaleDateString()} by {link.createdBy}. The link stays active until you turn it off.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No link has been created for this quote yet.</p>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {link ? (
              confirmRevoke ? (
                <Button variant="destructive" onClick={() => revokeMutation.mutate()} disabled={revokeMutation.isPending}>
                  <Link2Off className="w-4 h-4 mr-2" />
                  {revokeMutation.isPending ? "Turning off…" : "Yes, turn off this link"}
                </Button>
              ) : (
                <Button variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50" onClick={() => setConfirmRevoke(true)}>
                  <Link2Off className="w-4 h-4 mr-2" />
                  Turn off link
                </Button>
              )
            ) : <span />}
            {!link && quoteId && !missingSiteId && !linkQuery.isLoading && (
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                <Link2 className="w-4 h-4 mr-2" />
                {createMutation.isPending ? "Creating…" : "Create & copy link"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
