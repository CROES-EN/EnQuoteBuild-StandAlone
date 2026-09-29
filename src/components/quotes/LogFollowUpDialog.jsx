import {useState} from "react";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {createLocalRecords, getCurrentUser, updateQuote} from "@/api/dataClient";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {AtSign, Loader2, MessageSquarePlus} from "lucide-react";
import {toast} from "sonner";
import {parseMentions} from "@/utils/quoteSLA";

export default function LogFollowUpDialog({ quote, open, onOpenChange, onLogged }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [mentionPriority, setMentionPriority] = useState("yellow");

  const mentions = parseMentions(note);

  const logMutation = useMutation({
    mutationFn: async () => {
      const user = await getCurrentUser();
      const now = new Date().toISOString();
      const history = quote.status_history || [];
      await updateQuote(quote.id, {
        last_follow_up_date: now,
        status_history: [
          ...history,
          {
            status: quote.status,
            changed_by: user?.email,
            changed_at: now,
            reason: note.trim() || "Follow-up logged",
            entry_type: "follow_up",
          },
        ],
      });
      if (mentions.length > 0) {
        // FIX (confirmed root cause, same category of bug already found and fixed
        // twice tonight in Quotes.jsx and outboundSync.cjs): this previously called
        // base44.functions.invoke("manageQuoteAlerts", ...) directly, which CANNOT
        // work at all in desktop/local mode -- there is no serverless Base44 backend
        // to call locally. Every @mention created on desktop has therefore been
        // silently failing to send. Routed through createLocalRecords() into the
        // local "quoteAlerts" collection instead -- the same collection Quotes.jsx's
        // myMentions query already reads from correctly -- and (once
        // add-dismissal-outbound-sync.ps1's sibling fix is extended to quoteAlerts)
        // will sync outbound to Base44 the same proven way dismissals now do.
        await createLocalRecords(
          "quoteAlerts",
          mentions.map((m) => ({
            quote_id: quote.id,
            site_id: quote.site_id || "",
            mentioned_email: m.email,
            mentioned_by: user?.email,
            message: note.trim(),
            priority: mentionPriority,
            is_resolved: false,
          }))
        );
      }
      // FIX: previously, whether logging a follow-up cleared this quote's alert
      // depended entirely on WHICH screen opened this dialog correctly wiring up an
      // onLogged callback that happened to dismiss it (StatusAlerts.jsx did; nothing
      // else was guaranteed to). Moved here, into the dialog itself, so logging a
      // follow-up ALWAYS clears the alert for this quote, no matter where it was
      // opened from -- onLogged (below) is still called too, for any additional
      // screen-specific behavior a caller may want.
      // REVERTED: a permanent dismissal here would conflict with the intended behavior --
      // the alert's "days in status" clock ALREADY correctly resets on its own whenever a
      // follow-up is logged (LogFollowUpDialog's own status_history push above adds a
      // fresh changed_at timestamp, which both StatusAlerts.jsx's day-based threshold and
      // quoteSLA.js's hour-based threshold read directly -- confirmed and tested). A
      // PERMANENT dismissal would hide this quote's alerts forever, even after the clock
      // naturally re-crosses the threshold again -- which is the opposite of "reset and
      // reappear later if still needed." No explicit dismissal is needed for this to work
      // correctly.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["quoteAlerts"] });
      toast.success("Follow-up logged");
      if (mentions.length > 0) {
        toast.success(`${mentions.length} mention${mentions.length > 1 ? "s" : ""} sent`);
      }
      setNote("");
      setMentionPriority("yellow");
      onOpenChange(false);
      onLogged?.();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to log follow-up");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Follow-Up</DialogTitle>
          <DialogDescription>
            Record that you've followed up on this quote. This updates the last-touched date and adds an entry to the history.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note. Use @username to mention someone (e.g. @dudavis, have we received an update?)"
          rows={4}
        />
        {mentions.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {mentions.map((m) => (
                <span key={m.email} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
                  <AtSign className="w-3 h-3" />
                  {m.username}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Priority:</span>
              <Select value={mentionPriority} onValueChange={setMentionPriority}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yellow">Yellow — Normal</SelectItem>
                  <SelectItem value="orange">Orange — High</SelectItem>
                  <SelectItem value="red">Red — Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => logMutation.mutate()}
            disabled={logMutation.isPending}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {logMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <MessageSquarePlus className="w-4 h-4 mr-2" />
            )}
            Log Follow-Up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}