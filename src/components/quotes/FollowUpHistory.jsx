import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Clock, Send, User } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { createFollowUp, getFollowUps, isLocalDataSource } from "@/api/dataClient";

export default function FollowUpHistory({ quoteId }) {
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualFormData, setManualFormData] = useState({
    email_subject: "",
    email_body: "",
    recipient_emails: ""
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["followUpLogs", quoteId],
    queryFn: () => getFollowUps(quoteId),
    enabled: !!quoteId
  });

  const sendManualMutation = useMutation({
    mutationFn: (data) => isLocalDataSource ? createFollowUp({ ...data, quote_id: quoteId, sent_date: new Date().toISOString(), delivery_status: "demo_recorded" }) : base44.functions.invoke('sendManualFollowUp', data),
    onSuccess: () => {
      toast.success("Follow-up sent successfully");
      setShowManualDialog(false);
      setManualFormData({
        email_subject: "",
        email_body: "",
        recipient_emails: ""
      });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to send follow-up");
    }
  });

  const handleSendManual = () => {
    const recipients = manualFormData.recipient_emails
      .split(",")
      .map(email => email.trim())
      .filter(email => email);

    if (recipients.length === 0) {
      toast.error("Please enter at least one recipient email");
      return;
    }

    sendManualMutation.mutate({
      quote_id: quoteId,
      email_subject: manualFormData.email_subject,
      email_body: manualFormData.email_body,
      recipient_emails: recipients
    });
  };

  const sortedLogs = [...logs].sort((a, b) => 
    new Date(b.sent_date) - new Date(a.sent_date)
  );

  return (
    <>
      <Card className="p-6 mt-6 border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Follow-Up History</h3>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowManualDialog(true)}
            className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
          >
            <Send className="w-4 h-4 mr-2" />
            Send Manual Follow-Up
          </Button>
        </div>

        {sortedLogs.length === 0 ? (
          <p className="text-slate-500 text-center py-8">No follow-ups sent yet</p>
        ) : (
          <div className="space-y-4">
            {sortedLogs.map((log, index) => (
              <div key={index} className="flex gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                <div className="flex-shrink-0 w-2 h-2 rounded-full bg-indigo-600 mt-2" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {log.was_manual ? (
                        <User className="w-4 h-4 text-purple-600" />
                      ) : (
                        <Clock className="w-4 h-4 text-indigo-600" />
                      )}
                      <span className="font-medium text-slate-900">
                        {log.was_manual ? "Manual Follow-Up" : "Automated Follow-Up"}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {format(new Date(log.sent_date), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{log.trigger_reason}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Sent to: {log.recipients.join(", ")}
                  </p>
                  {log.triggered_by && (
                    <p className="text-xs text-slate-500">
                      Triggered by: {log.triggered_by}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Manual Follow-Up</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="manual_subject">Email Subject</Label>
              <Input
                id="manual_subject"
                value={manualFormData.email_subject}
                onChange={(e) => setManualFormData({ ...manualFormData, email_subject: e.target.value })}
                placeholder="Follow-up for Quote {site_id}"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="manual_body">Email Body</Label>
              <Textarea
                id="manual_body"
                value={manualFormData.email_body}
                onChange={(e) => setManualFormData({ ...manualFormData, email_body: e.target.value })}
                placeholder="Use placeholders: {quote_number}, {site_id}, {total}, {status}"
                rows={6}
                className="mt-1.5"
              />
              <p className="text-xs text-slate-500 mt-1">
                Available placeholders: {"{quote_number}"}, {"{site_id}"}, {"{total}"}, {"{status}"}
              </p>
            </div>

            <div>
              <Label htmlFor="manual_recipients">Recipient Emails (comma-separated)</Label>
              <Input
                id="manual_recipients"
                value={manualFormData.recipient_emails}
                onChange={(e) => setManualFormData({ ...manualFormData, recipient_emails: e.target.value })}
                placeholder="email1@example.com, email2@example.com"
                className="mt-1.5"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSendManual}
              disabled={
                sendManualMutation.isPending ||
                !manualFormData.email_subject || 
                !manualFormData.email_body || 
                !manualFormData.recipient_emails
              }
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {sendManualMutation.isPending ? "Sending..." : "Send Follow-Up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}