import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Plus, Mail, Trash2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import RoleGuard from "@/components/auth/RoleGuard";
import { getUsers } from "@/api/dataClient";

const emailTypeLabels = {
  quote_submitted: {
    label: "Quote Submitted for Approval",
    description: "Emails sent when a quote is submitted",
    color: "amber"
  },
  quote_approved: {
    label: "Quote Approved",
    description: "Emails sent when a quote is approved",
    color: "emerald"
  },
  quote_rejected: {
    label: "Quote Rejected",
    description: "Emails sent when a quote is rejected",
    color: "rose"
  },
  quote_sent_to_ho: {
    label: "Quote Sent to HO",
    description: "Emails sent when a quote is sent to HO",
    color: "purple"
  },
  ho_approved_invoice_required: {
    label: "HO Approved, Invoice Required",
    description: "Emails sent when HO approves and invoice is required",
    color: "orange"
  },
  invoiced: {
    label: "Invoiced",
    description: "Emails sent when a quote is marked as invoiced",
    color: "blue"
  },
  invoice_paid: {
    label: "Invoice Paid",
    description: "Emails sent when an invoice is marked as paid",
    color: "green"
  },
  ho_rejected: {
    label: "HO Rejected",
    description: "Emails sent when HO rejects a quote",
    color: "red"
  }
};

function EmailNotificationsContent() {
  const queryClient = useQueryClient();
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [formData, setFormData] = useState({
    recipient_email: "",
    is_active: true
  });

  const { data: distributions = [], isLoading } = useQuery({
    queryKey: ["emailDistributions"],
    queryFn: () => base44.entities.EmailDistribution.list(),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.EmailDistribution.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emailDistributions"] });
      setShowAddSheet(false);
      setFormData({ recipient_email: "", is_active: true });
      setSelectedType(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.EmailDistribution.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emailDistributions"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.EmailDistribution.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emailDistributions"] });
    }
  });

  const handleAddRecipient = (type) => {
    setSelectedType(type);
    setShowAddSheet(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const selectedUser = users.find(u => u.email === formData.recipient_email);
    createMutation.mutate({
      email_type: selectedType,
      recipient_email: formData.recipient_email,
      recipient_name: selectedUser?.full_name || formData.recipient_email,
      is_active: formData.is_active
    });
  };

  const toggleActive = (distribution) => {
    updateMutation.mutate({
      id: distribution.id,
      data: { is_active: !distribution.is_active }
    });
  };

  const groupedDistributions = {
    quote_submitted: distributions.filter(d => d.email_type === "quote_submitted"),
    quote_approved: distributions.filter(d => d.email_type === "quote_approved"),
    quote_rejected: distributions.filter(d => d.email_type === "quote_rejected"),
    quote_sent_to_ho: distributions.filter(d => d.email_type === "quote_sent_to_ho"),
    ho_approved_invoice_required: distributions.filter(d => d.email_type === "ho_approved_invoice_required"),
    invoiced: distributions.filter(d => d.email_type === "invoiced"),
    invoice_paid: distributions.filter(d => d.email_type === "invoice_paid"),
    ho_rejected: distributions.filter(d => d.email_type === "ho_rejected")
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Email Notifications</h1>
          <p className="text-slate-600 mt-2">Manage distribution lists for automated quote notifications</p>
        </div>

        <div className="space-y-6">
          {Object.entries(emailTypeLabels).map(([type, config]) => (
            <motion.div
              key={type}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="p-6 border-slate-200">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">{config.label}</h2>
                    <p className="text-sm text-slate-500 mt-1">{config.description}</p>
                  </div>
                  <Button
                    onClick={() => handleAddRecipient(type)}
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Recipient
                  </Button>
                </div>

                {groupedDistributions[type].length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg">
                    <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-slate-600">No recipients configured</p>
                    <p className="text-sm text-slate-500 mt-1">Add recipients to receive notifications</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedDistributions[type].map((dist) => (
                      <div
                        key={dist.id}
                        className="flex items-center justify-between p-4 bg-slate-50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                            <Mail className="w-5 h-5 text-indigo-600" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{dist.recipient_name || dist.recipient_email}</p>
                            {dist.recipient_name && (
                              <p className="text-sm text-slate-500">{dist.recipient_email}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`active-${dist.id}`} className="text-sm text-slate-600">
                              {dist.is_active ? "Active" : "Inactive"}
                            </Label>
                            <Switch
                              id={`active-${dist.id}`}
                              checked={dist.is_active}
                              onCheckedChange={() => toggleActive(dist)}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(dist.id)}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      <Sheet open={showAddSheet} onOpenChange={setShowAddSheet}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add Email Recipient</SheetTitle>
            <SheetDescription>
              Add a recipient to the {selectedType && emailTypeLabels[selectedType].label.toLowerCase()} distribution list
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="recipient_email">Select User *</Label>
              <Select
                value={formData.recipient_email}
                onValueChange={(value) => setFormData({ ...formData, recipient_email: value })}
                required
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select a user..." />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.email}>
                      <div className="flex flex-col">
                        <span className="font-medium">{user.full_name}</span>
                        <span className="text-xs text-slate-500">{user.email}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1.5">Only registered app users can receive email notifications</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddSheet(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                {createMutation.isPending ? "Adding..." : "Add Recipient"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function EmailNotifications() {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <EmailNotificationsContent />
    </RoleGuard>
  );
}