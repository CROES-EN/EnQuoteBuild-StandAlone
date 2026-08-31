import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import RoleGuard from "@/components/auth/RoleGuard";

function FollowUpSettingsContent() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    trigger_type: "expiration_approaching",
    status: "submitted",
    days_threshold: 3,
    email_subject: "",
    email_body: "",
    recipient_emails: "",
    is_active: true
  });

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["followUpConfigs"],
    queryFn: () => base44.entities.FollowUpConfig.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FollowUpConfig.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followUpConfigs"] });
      toast.success("Follow-up rule created");
      handleCloseDialog();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FollowUpConfig.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followUpConfigs"] });
      toast.success("Follow-up rule updated");
      handleCloseDialog();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FollowUpConfig.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["followUpConfigs"] });
      toast.success("Follow-up rule deleted");
    }
  });

  const handleOpenDialog = (config = null) => {
    if (config) {
      setEditingConfig(config);
      setFormData({
        name: config.name,
        trigger_type: config.trigger_type,
        status: config.status || "submitted",
        days_threshold: config.days_threshold,
        email_subject: config.email_subject,
        email_body: config.email_body,
        recipient_emails: config.recipient_emails?.join(", ") || "",
        is_active: config.is_active
      });
    } else {
      setEditingConfig(null);
      setFormData({
        name: "",
        trigger_type: "expiration_approaching",
        status: "submitted",
        days_threshold: 3,
        email_subject: "",
        email_body: "",
        recipient_emails: "",
        is_active: true
      });
    }
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingConfig(null);
  };

  const handleSave = () => {
    const recipient_emails = formData.recipient_emails
      .split(",")
      .map(email => email.trim())
      .filter(email => email);

    const data = {
      ...formData,
      recipient_emails,
      days_threshold: parseInt(formData.days_threshold)
    };

    if (editingConfig) {
      updateMutation.mutate({ id: editingConfig.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Follow-Up Settings</h1>
            <p className="text-slate-600 mt-1">Configure automated reminders for quotes</p>
          </div>
          <Button onClick={() => handleOpenDialog()} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </Button>
        </div>

        <div className="grid gap-4">
          {configs.map((config) => (
            <Card key={config.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-slate-900">{config.name}</h3>
                    <Switch
                      checked={config.is_active}
                      onCheckedChange={(checked) => 
                        updateMutation.mutate({ 
                          id: config.id, 
                          data: { ...config, is_active: checked } 
                        })
                      }
                    />
                  </div>
                  
                  <div className="space-y-2 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      {config.trigger_type === "expiration_approaching" ? (
                        <>
                          <Clock className="w-4 h-4" />
                          <span>Send reminder {config.days_threshold} days before expiration</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4" />
                          <span>Send reminder after {config.days_threshold} days in "{config.status}" status</span>
                        </>
                      )}
                    </div>
                    <div>
                      <span className="font-medium">Subject:</span> {config.email_subject}
                    </div>
                    {config.recipient_emails && config.recipient_emails.length > 0 && (
                      <div>
                        <span className="font-medium">Recipients:</span> {config.recipient_emails.join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(config)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => deleteMutation.mutate(config.id)}
                  >
                    <Trash2 className="w-4 h-4 text-rose-600" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}

          {configs.length === 0 && (
            <Card className="p-12 text-center">
              <Clock className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No Follow-Up Rules</h3>
              <p className="text-slate-600 mb-4">Create automated reminders for quotes</p>
              <Button onClick={() => handleOpenDialog()} className="bg-indigo-600 hover:bg-indigo-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Rule
              </Button>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingConfig ? "Edit" : "Create"} Follow-Up Rule</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Rule Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Expiring Quotes Reminder"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="trigger_type">Trigger Type</Label>
              <Select
                value={formData.trigger_type}
                onValueChange={(value) => setFormData({ ...formData, trigger_type: value })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expiration_approaching">Expiration Approaching</SelectItem>
                  <SelectItem value="status_duration">Time in Status</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.trigger_type === "status_duration" && (
              <div>
                <Label htmlFor="status">Quote Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="quote_sent_to_ho">Quote Sent to HO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="days_threshold">
                {formData.trigger_type === "expiration_approaching" 
                  ? "Days Before Expiration" 
                  : "Days in Status"}
              </Label>
              <Input
                id="days_threshold"
                type="number"
                min="1"
                value={formData.days_threshold}
                onChange={(e) => setFormData({ ...formData, days_threshold: e.target.value })}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="email_subject">Email Subject</Label>
              <Input
                id="email_subject"
                value={formData.email_subject}
                onChange={(e) => setFormData({ ...formData, email_subject: e.target.value })}
                placeholder="Quote Follow-Up: {site_id}"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="email_body">Email Body</Label>
              <Textarea
                id="email_body"
                value={formData.email_body}
                onChange={(e) => setFormData({ ...formData, email_body: e.target.value })}
                placeholder="Use placeholders: {quote_number}, {site_id}, {total}, {status}, {reason}"
                rows={6}
                className="mt-1.5"
              />
              <p className="text-xs text-slate-500 mt-1">
                Available placeholders: {"{quote_number}"}, {"{site_id}"}, {"{total}"}, {"{status}"}, {"{reason}"}
              </p>
            </div>

            <div>
              <Label htmlFor="recipient_emails">Recipient Emails (comma-separated)</Label>
              <Input
                id="recipient_emails"
                value={formData.recipient_emails}
                onChange={(e) => setFormData({ ...formData, recipient_emails: e.target.value })}
                placeholder="email1@example.com, email2@example.com"
                className="mt-1.5"
              />
              <p className="text-xs text-slate-500 mt-1">
                Quote creator will always be included
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!formData.name || !formData.email_subject || !formData.email_body}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {editingConfig ? "Update" : "Create"} Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function FollowUpSettings() {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <FollowUpSettingsContent />
    </RoleGuard>
  );
}