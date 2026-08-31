import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { bulkUpdateQuotes, createLocalRecord, createQuote, createReview, deleteQuote, getCurrentUser, getQuoteById, getQuotes, getReviews, getUsers, listLocalCollection, updateQuote, updateReview } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation} from "react-router-dom";
import { createPageUrl } from "@/utils";
import { calculateQuoteTotals } from "@/utils/quoteCalculations";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  Pencil, 
  Send, 
  CheckCircle, 
  XCircle,
  Calendar,
  Hash,
  Trash2,
  Download,
  FileText,
  Users,
  Receipt,
  EyeOff,
  UserCog,
  MessageSquarePlus,
  Archive,
  ArchiveRestore,
  CalendarCheck,
  ClipboardList,
  CopyPlus
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import StatusBadge from "@/components/quotes/StatusBadge";
import { motion } from "framer-motion";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import { generateQuotePDF, generateCustomerQuotePDF } from "@/components/quotes/QuotePDFGenerator";
import QuoteVersionHistory from "@/components/quotes/QuoteVersionHistory";
import FollowUpHistory from "@/components/quotes/FollowUpHistory";
import QuoteActivityLog from "@/components/quotes/QuoteActivityLog";
import QuoteVersionComparison from "@/components/quotes/QuoteVersionComparison";

// Only these users can grant/revoke pre-approval
const PRE_APPROVAL_USERS = ["smosley@enphaseenergy.com", "tjm8189@gmail.com"];

// Users who can edit and re-approve quotes that are in "quote_sent_to_ho" status
const HO_EDIT_USERS = ["smosley@enphaseenergy.com", "vseganos@enphaseenergy.com", "tjm8189@gmail.com"];

function QuoteDetailsContent() {
  const { isApprover, isAdmin, isSubmitter, roles, user } = useUserRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const quoteId = urlParams.get("id");

  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showHORejectDialog, setShowHORejectDialog] = useState(false);
  const [hoRejectionReason, setHoRejectionReason] = useState("");
  const [showDeleteRequestDialog, setShowDeleteRequestDialog] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [showChangeOwnerDialog, setShowChangeOwnerDialog] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  const [showFollowUpDialog, setShowFollowUpDialog] = useState(false);
  const [followUpNote, setFollowUpNote] = useState("");
  const [showBoneyardDialog, setShowBoneyardDialog] = useState(false);
  const [boneyardReason, setBoneyardReason] = useState("");
  const [decisionCategory, setDecisionCategory] = useState("no_customer_response");
  const [showPaidDialog, setShowPaidDialog] = useState(false);
  const [paidDate, setPaidDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [stripeTransactionId, setStripeTransactionId] = useState("");
  const [stripeInvoiceId, setStripeInvoiceId] = useState("");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote", quoteId],
    queryFn: async () => {
      return getQuoteById(quoteId);
    },
    enabled: !!quoteId
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateQuote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteQuote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      navigate(createPageUrl("Quotes"));
    }
  });

  const saveCopyMutation = useMutation({
    mutationFn: async () => {
      const currentUser = await getCurrentUser();
      const {
        id, created_date, updated_date, created_by, created_by_id, parent_quote_id,
        is_current_version, version_number, status, status_history, submitted_date,
        approved_date, approved_by, rejection_reason, quote_sent_to_ho_date,
        ho_approved_date, ho_rejection_reason, ho_rejected_date, invoiced_date,
        invoice_paid_date, stripe_transaction_id, stripe_invoice_id, paid_at_date,
        scheduled_date, pre_hold_status, hold_reason, hold_date, last_follow_up_date,
        exclude_from_reporting, ...copyData
      } = quote;
      const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
      return createQuote({
        ...copyData,
        quote_number: `Q-${suffix}`,
        owner_email: currentUser.email,
        status: "draft_without_internal",
        pre_approved: false,
        pre_approved_by: null,
        pre_approved_date: null,
        status_history: [{
          status: "draft_without_internal",
          changed_by: currentUser.email,
          changed_at: new Date().toISOString(),
          reason: `Saved as a pricing option from ${quote.quote_number || quote.site_id}`
        }]
      });
    },
    onSuccess: (copiedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Quote copy created as a new pricing option");
      navigate(createPageUrl(`EditQuote?id=${copiedQuote.id}`));
    }
  });

  const requestDeletionMutation = useMutation({
    mutationFn: async (data) => createLocalRecord("deletionRequests", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deletionRequests"] });
      setShowDeleteRequestDialog(false);
      setDeletionReason("");
      toast.success("Deletion request submitted successfully");
    },
    onError: () => {
      toast.error("Failed to submit deletion request");
    }
  });

  const { data: deletionRequest } = useQuery({
    queryKey: ["deletionRequest", quoteId],
    queryFn: async () => {
      try {
        const requests = (await listLocalCollection("deletionRequests")).filter(request => request.quote_id === quoteId && request.status === "pending");
        return requests[0];
      } catch {
        return null;
      }
    },
    enabled: !!quoteId
  });

  const handleRequestDeletion = async () => {
    const user = await base44.auth.me();
    await requestDeletionMutation.mutateAsync({
      quote_id: quoteId,
      quote_number: quote.quote_number || quote.site_id,
      requested_by: user.email,
      reason: deletionReason
    });
  };

  const canPreApprove = PRE_APPROVAL_USERS.includes(user?.email?.toLowerCase());
  const canEditHOQuote = HO_EDIT_USERS.includes(user?.email?.toLowerCase());

  const handleTogglePreApproval = async (checked) => {
    const me = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: {
        pre_approved: checked,
        pre_approved_by: checked ? me.email : null,
        pre_approved_date: checked ? new Date().toISOString() : null,
      }
    });
    toast.success(checked ? "Pre-approval granted" : "Pre-approval removed");
  };

  const handleSubmit = async () => {
    console.log('ðŸš€ handleSubmit called - Starting quote submission');
    console.log('ðŸ“‹ Quote data:', { id: quoteId, site_id: quote.site_id, created_by: quote.created_by });
    
    const user = await base44.auth.me();
    console.log('ðŸ‘¤ Current user:', user.email);
    
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "submitted",
        submitted_date: new Date().toISOString(),
        status_history: [
          ...(quote.status_history || []),
          {
            status: "submitted",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: null
          }
        ]
      }
    });
    
    console.log('âœ… Quote status updated to submitted');
    console.log('ðŸ“§ Starting email notification process...');
    
    const distributions = await base44.entities.EmailDistribution.filter({
      email_type: "quote_submitted",
      is_active: true
    });
    
    console.log('ðŸ“§ Found distributions:', distributions.length);
    console.log('ðŸ“§ Distribution details:', distributions);
    console.log('ðŸ“§ Quote creator:', quote.created_by);
    
    const emailRecipients = [
      ...distributions.map(d => d.recipient_email),
      ...(quote.created_by ? [quote.created_by] : [])
    ];
    console.log('ðŸ“§ Will send emails to:', emailRecipients);
    
    const emailResults = await Promise.allSettled([
      ...distributions.map(dist =>
        base44.integrations.Core.SendEmail({
          to: dist.recipient_email,
          subject: `New Quote Submitted: ${quote.site_id || quote.quote_number}`,
          body: `A new quote has been submitted for approval.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nPlease review and approve/reject in the system.`
        }).then(() => {
          console.log('âœ… Email sent successfully to:', dist.recipient_email);
          return { email: dist.recipient_email, success: true };
        }).catch(err => {
          console.error('âŒ Email failed to:', dist.recipient_email, err);
          return { email: dist.recipient_email, success: false, error: err };
        })
      ),
      ...(quote.created_by ? [
        base44.integrations.Core.SendEmail({
          to: quote.created_by,
          subject: `Quote Submitted Successfully: ${quote.site_id || quote.quote_number}`,
          body: `Your quote has been submitted for approval.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nYou will be notified once it's reviewed.`
        }).then(() => {
          console.log('âœ… Email sent successfully to creator:', quote.created_by);
          return { email: quote.created_by, success: true };
        }).catch(err => {
          console.error('âŒ Email failed to creator:', quote.created_by, err);
          return { email: quote.created_by, success: false, error: err };
        })
      ] : [])
    ]);
    
    console.log('ðŸ“§ Email results:', emailResults);
    
    const failedEmails = emailResults
      .filter(result => result.status === 'fulfilled' && !result.value.success)
      .map(result => result.value.email);
    
    const rejectedEmails = emailResults
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    
    console.log('âŒ Failed emails:', failedEmails);
    console.log('âŒ Rejected emails:', rejectedEmails);
    
    if (failedEmails.length > 0) {
      toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
    } else if (rejectedEmails.length > 0) {
      toast.error(`Email sending rejected: ${rejectedEmails.length} errors`);
      console.error('Email rejection details:', rejectedEmails);
    } else {
      toast.success(`Quote submitted! Notifications sent to ${emailRecipients.length} recipient(s)`);
    }
  };

  const handleApprove = async () => {
    const user = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "approved",
        approved_date: new Date().toISOString(),
        approved_by: user.email,
        status_history: [
          ...(quote.status_history || []),
          {
            status: "approved",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: approveNote.trim() || null
          }
        ]
      }
    });
    await closeRejectedSiblings(quote, "approved");
    
    // Try to generate and attach PDF - if it fails, still send emails without it
    let pdfUrl = null;
    try {
      const pdfBlob = await generateQuotePDF(quote);
      const pdfFile = new File([pdfBlob], `quote-${quote.site_id || quote.quote_number}.pdf`, { type: 'application/pdf' });
      const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
      pdfUrl = file_url;
    } catch (pdfError) {
      console.error('PDF generation failed, sending emails without PDF:', pdfError);
    }

    try {
      const distributions = await base44.entities.EmailDistribution.filter({
        email_type: "quote_approved",
        is_active: true
      });
      
      const pdfLine = pdfUrl ? `\n\nDownload PDF: ${pdfUrl}` : '';

      const emailResults = await Promise.allSettled([
        ...distributions.map(dist =>
          base44.integrations.Core.SendEmail({
            to: dist.recipient_email,
            subject: `Quote Approved: ${quote.site_id || quote.quote_number}`,
            body: `A quote has been approved.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nThe quote is now ready for invoicing.${pdfLine}`
          }).then(() => ({ email: dist.recipient_email, success: true }))
            .catch(() => ({ email: dist.recipient_email, success: false }))
        ),
        ...(quote.created_by ? [
          base44.integrations.Core.SendEmail({
            to: quote.created_by,
            subject: `Your Quote Was Approved: ${quote.site_id || quote.quote_number}`,
            body: `Good news! Your quote has been approved.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nThe quote is now ready for invoicing.${pdfLine}`
          }).then(() => ({ email: quote.created_by, success: true }))
            .catch(() => ({ email: quote.created_by, success: false }))
        ] : [])
      ]);
      
      const failedEmails = emailResults
        .filter(result => result.status === 'fulfilled' && !result.value.success)
        .map(result => result.value.email);
      
      if (failedEmails.length > 0) {
        toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
      } else {
        toast.success('Quote approved and notifications sent');
      }
    } catch (error) {
      toast.error('Failed to send approval notifications');
    }
    setShowApproveDialog(false);
    setApproveNote("");
  };

  const handleReject = async () => {
    const user = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "rejected",
        rejection_reason: rejectionReason,
        status_history: [
          ...(quote.status_history || []),
          {
            status: "rejected",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: rejectionReason
          }
        ]
      }
    });
    
    try {
      const distributions = await base44.entities.EmailDistribution.filter({
        email_type: "quote_rejected",
        is_active: true
      });
      
      const emailResults = await Promise.allSettled([
        ...distributions.map(dist =>
          base44.integrations.Core.SendEmail({
            to: dist.recipient_email,
            subject: `Quote Rejected: ${quote.site_id || quote.quote_number}`,
            body: `A quote has been rejected.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nReason: ${rejectionReason}`
          }).then(() => ({ email: dist.recipient_email, success: true }))
            .catch(err => ({ email: dist.recipient_email, success: false }))
        ),
        ...(quote.created_by ? [
          base44.integrations.Core.SendEmail({
            to: quote.created_by,
            subject: `Your Quote Was Rejected: ${quote.site_id || quote.quote_number}`,
            body: `Your quote has been rejected.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nReason: ${rejectionReason}`
          }).then(() => ({ email: quote.created_by, success: true }))
            .catch(err => ({ email: quote.created_by, success: false }))
        ] : [])
      ]);
      
      const failedEmails = emailResults
        .filter(result => result.status === 'fulfilled' && !result.value.success)
        .map(result => result.value.email);
      
      if (failedEmails.length > 0) {
        toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
      } else {
        toast.success('Notifications sent successfully');
      }
    } catch (error) {
      toast.error('Failed to send email notifications');
    }
    
    setShowRejectDialog(false);
  };

  const handleMarkQuoteSentToHO = async () => {
    const user = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "quote_sent_to_ho",
        quote_sent_to_ho_date: new Date().toISOString(),
        status_history: [
          ...(quote.status_history || []),
          {
            status: "quote_sent_to_ho",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: null
          }
        ]
      }
    });
    await closeRejectedSiblings(quote, "quote_sent_to_ho");
    
    try {
      const distributions = await base44.entities.EmailDistribution.filter({
        email_type: "quote_sent_to_ho",
        is_active: true
      });
      
      const emailResults = await Promise.allSettled([
        ...distributions.map(dist =>
          base44.integrations.Core.SendEmail({
            to: dist.recipient_email,
            subject: `Quote Sent to HO: ${quote.site_id || quote.quote_number}`,
            body: `A quote has been sent to HO.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: dist.recipient_email, success: true }))
            .catch(err => ({ email: dist.recipient_email, success: false }))
        ),
        ...(quote.created_by ? [
          base44.integrations.Core.SendEmail({
            to: quote.created_by,
            subject: `Your Quote Sent to HO: ${quote.site_id || quote.quote_number}`,
            body: `Your quote has been sent to HO.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: quote.created_by, success: true }))
            .catch(err => ({ email: quote.created_by, success: false }))
        ] : [])
      ]);
      
      const failedEmails = emailResults
        .filter(result => result.status === 'fulfilled' && !result.value.success)
        .map(result => result.value.email);
      
      if (failedEmails.length > 0) {
        toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
      } else {
        toast.success('Notifications sent successfully');
      }
    } catch (error) {
      toast.error('Failed to send email notifications');
    }
  };

  const handleMarkHOApproved = async () => {
    const user = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "ho_approved_invoice_required",
        ho_approved_date: new Date().toISOString(),
        status_history: [
          ...(quote.status_history || []),
          {
            status: "ho_approved_invoice_required",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: null
          }
        ]
      }
    });
    await closeRejectedSiblings(quote, "ho_approved_invoice_required");
    
    try {
      const distributions = await base44.entities.EmailDistribution.filter({
        email_type: "ho_approved_invoice_required",
        is_active: true
      });
      
      const emailResults = await Promise.allSettled([
        ...distributions.map(dist =>
          base44.integrations.Core.SendEmail({
            to: dist.recipient_email,
            subject: `HO Approved, Invoice Required: ${quote.site_id || quote.quote_number}`,
            body: `HO has approved the quote and an invoice is required.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: dist.recipient_email, success: true }))
            .catch(err => ({ email: dist.recipient_email, success: false }))
        ),
        ...(quote.created_by ? [
          base44.integrations.Core.SendEmail({
            to: quote.created_by,
            subject: `Your Quote HO Approved: ${quote.site_id || quote.quote_number}`,
            body: `HO has approved your quote and an invoice is required.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: quote.created_by, success: true }))
            .catch(err => ({ email: quote.created_by, success: false }))
        ] : [])
      ]);
      
      const failedEmails = emailResults
        .filter(result => result.status === 'fulfilled' && !result.value.success)
        .map(result => result.value.email);
      
      if (failedEmails.length > 0) {
        toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
      } else {
        toast.success('Notifications sent successfully');
      }
    } catch (error) {
      toast.error('Failed to send email notifications');
    }
  };

  const handleMarkInvoiced = async () => {
    const user = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "invoiced",
        invoiced_date: new Date().toISOString(),
        status_history: [
          ...(quote.status_history || []),
          {
            status: "invoiced",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: null
          }
        ]
      }
    });
    await closeRejectedSiblings(quote, "invoiced");
    
    try {
      const distributions = await base44.entities.EmailDistribution.filter({
        email_type: "invoiced",
        is_active: true
      });
      
      const emailResults = await Promise.allSettled([
        ...distributions.map(dist =>
          base44.integrations.Core.SendEmail({
            to: dist.recipient_email,
            subject: `Quote Invoiced: ${quote.site_id || quote.quote_number}`,
            body: `A quote has been marked as invoiced.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: dist.recipient_email, success: true }))
            .catch(err => ({ email: dist.recipient_email, success: false }))
        ),
        ...(quote.created_by ? [
          base44.integrations.Core.SendEmail({
            to: quote.created_by,
            subject: `Your Quote Invoiced: ${quote.site_id || quote.quote_number}`,
            body: `Your quote has been marked as invoiced.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: quote.created_by, success: true }))
            .catch(err => ({ email: quote.created_by, success: false }))
        ] : [])
      ]);
      
      const failedEmails = emailResults
        .filter(result => result.status === 'fulfilled' && !result.value.success)
        .map(result => result.value.email);
      
      if (failedEmails.length > 0) {
        toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
      } else {
        toast.success('Notifications sent successfully');
      }
    } catch (error) {
      toast.error('Failed to send email notifications');
    }
  };

  const handleHOReject = async () => {
    const user = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "ho_rejected",
        ho_rejected_date: new Date().toISOString(),
        ho_rejection_reason: `${decisionCategory} â€” ${hoRejectionReason}`,
        status_history: [
          ...(quote.status_history || []),
          {
            status: "ho_rejected",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: hoRejectionReason
          }
        ]
      }
    });
    
    try {
      const distributions = await base44.entities.EmailDistribution.filter({
        email_type: "ho_rejected",
        is_active: true
      });
      
      const emailResults = await Promise.allSettled([
        ...distributions.map(dist =>
          base44.integrations.Core.SendEmail({
            to: dist.recipient_email,
            subject: `HO Rejected Quote: ${quote.site_id || quote.quote_number}`,
            body: `HO has rejected a quote.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nReason: ${hoRejectionReason}`
          }).then(() => ({ email: dist.recipient_email, success: true }))
            .catch(err => ({ email: dist.recipient_email, success: false }))
        ),
        ...(quote.created_by ? [
          base44.integrations.Core.SendEmail({
            to: quote.created_by,
            subject: `HO Rejected Your Quote: ${quote.site_id || quote.quote_number}`,
            body: `HO has rejected your quote.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}\n\nReason: ${hoRejectionReason}`
          }).then(() => ({ email: quote.created_by, success: true }))
            .catch(err => ({ email: quote.created_by, success: false }))
        ] : [])
      ]);
      
      const failedEmails = emailResults
        .filter(result => result.status === 'fulfilled' && !result.value.success)
        .map(result => result.value.email);
      
      if (failedEmails.length > 0) {
        toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
      } else {
        toast.success('Notifications sent successfully');
      }
    } catch (error) {
      toast.error('Failed to send email notifications');
    }
    
    setShowHORejectDialog(false);
  };

  const handleStatusChange = async (newStatus) => {
    if (newStatus === quote.status) return;
    // If selecting "invoice_paid" via the dropdown, show the date picker dialog instead
    if (newStatus === "invoice_paid") {
      setPaidDate(format(new Date(), "yyyy-MM-dd"));
      setStripeTransactionId("");
      setStripeInvoiceId("");
      setPaymentConfirmed(false);
      setShowPaidDialog(true);
      return;
    }
    const currentUser = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: {
        status: newStatus,
        status_history: [
          ...(quote.status_history || []),
          {
            status: newStatus,
            changed_by: currentUser.email,
            changed_at: new Date().toISOString(),
            reason: `Status manually corrected from "${quote.status}" to "${newStatus}"`
          }
        ]
      }
    });
    toast.success(`Status changed to ${newStatus.replace(/_/g, " ")}`);
  };

  const handleMarkScheduled = async () => {
    const currentUser = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: {
        status: "scheduled",
        scheduled_date: new Date().toISOString(),
        status_history: [
          ...(quote.status_history || []),
          {
            status: "scheduled",
            changed_by: currentUser.email,
            changed_at: new Date().toISOString(),
            reason: "Quote scheduled for site visit â€” handed off to Scheduling team"
          }
        ]
      }
    });
    toast.success("Quote marked as Scheduled");
  };

  const handleCopyPartList = () => {
    const items = quote.items || [];
    if (items.length === 0) {
      toast.error("No line items to copy");
      return;
    }
    const text = items
      .map((item) => `${item.quantity || 1} ${item.unit || ""} - ${item.name}`.trim())
      .join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success(`Copied ${items.length} item${items.length > 1 ? "s" : ""} to clipboard`),
      () => toast.error("Failed to copy to clipboard")
    );
  };

  const handlePullBackToDraft = async () => {
    const currentUser = await base44.auth.me();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: {
        status: "draft_without_fst",
        status_history: [
          ...(quote.status_history || []),
          {
            status: "draft_without_fst",
            changed_by: currentUser.email,
            changed_at: new Date().toISOString(),
            reason: "Pulled back to draft by coordinator"
          }
        ]
      }
    });
    toast.success("Quote pulled back to draft");
  };

  const handleMarkInvoicePaid = async () => {
    const user = await base44.auth.me();
    const paidDateISO = new Date(paidDate + "T12:00:00").toISOString();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { 
        status: "invoice_paid",
        invoice_paid_date: paidDateISO,
        paid_at_date: paidDateISO,
        stripe_transaction_id: stripeTransactionId.trim(),
        stripe_invoice_id: stripeInvoiceId.trim(),
        status_history: [
          ...(quote.status_history || []),
          {
            status: "invoice_paid",
            changed_by: user.email,
            changed_at: new Date().toISOString(),
            reason: `Invoice marked as paid (paid date: ${format(new Date(paidDateISO), "MMM d, yyyy")}; Stripe transaction: ${stripeTransactionId.trim()}; Stripe invoice: ${stripeInvoiceId.trim()})`
          }
        ]
      }
    });
    await closeRejectedSiblings(quote, "invoice_paid");
    
    try {
      const distributions = await base44.entities.EmailDistribution.filter({
        email_type: "invoice_paid",
        is_active: true
      });
      
      const emailResults = await Promise.allSettled([
        ...distributions.map(dist =>
          base44.integrations.Core.SendEmail({
            to: dist.recipient_email,
            subject: `Invoice Paid: ${quote.site_id || quote.quote_number}`,
            body: `An invoice has been marked as paid.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: dist.recipient_email, success: true }))
            .catch(err => ({ email: dist.recipient_email, success: false }))
        ),
        ...(quote.created_by ? [
          base44.integrations.Core.SendEmail({
            to: quote.created_by,
            subject: `Your Invoice Paid: ${quote.site_id || quote.quote_number}`,
            body: `Your invoice has been marked as paid.\n\nSite ID: ${quote.site_id}\nTotal: $${quote.total.toFixed(2)}`
          }).then(() => ({ email: quote.created_by, success: true }))
            .catch(err => ({ email: quote.created_by, success: false }))
        ] : [])
      ]);
      
      const failedEmails = emailResults
        .filter(result => result.status === 'fulfilled' && !result.value.success)
        .map(result => result.value.email);
      
      if (failedEmails.length > 0) {
        toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
      } else {
        toast.success('Notifications sent successfully');
      }
    } catch (error) {
      toast.error('Failed to send email notifications');
    }
    setShowPaidDialog(false);
  };

  const { data: allUsers = [] } = useQuery({
    queryKey: ["allUsers"],
    queryFn: getUsers,
    enabled: isAdmin
  });

  const handleLogFollowUp = async () => {
    const currentUser = await getCurrentUser();
    const now = new Date().toISOString();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: {
        last_follow_up_date: now,
        status_history: [
          ...(quote.status_history || []),
          {
            entry_type: "follow_up",
            status: quote.status,
            changed_by: currentUser.email,
            changed_at: now,
            reason: followUpNote.trim() || "Follow-up logged"
          }
        ]
      }
    });
    toast.success("Follow-up logged successfully");
    setShowFollowUpDialog(false);
    setFollowUpNote("");
  };

  const handleMoveToBoneyard = async () => {
    const currentUser = await base44.auth.me();
    const now = new Date().toISOString();
    await updateMutation.mutateAsync({
      id: quoteId,
      data: {
        status: "on_hold",
        exclude_from_reporting: true,
        pre_hold_status: quote.status,
        hold_reason: `${decisionCategory} â€” ${boneyardReason.trim() || "On hold pending HO decision"}`, 
        hold_date: now,
        status_history: [
          ...(quote.status_history || []),
          {
            entry_type: "status_change",
            status: "on_hold",
            changed_by: currentUser.email,
            changed_at: now,
            reason: boneyardReason.trim() || "Moved to Boneyard â€” on hold pending HO decision"
          }
        ]
      }
    });
    toast.success("Quote moved to Boneyard â€” excluded from SLA & revenue reporting");
    setShowBoneyardDialog(false);
    setBoneyardReason("");
  };

  const handleRestoreFromBoneyard = async () => {
    const currentUser = await base44.auth.me();
    const now = new Date().toISOString();
    const restoredStatus = quote.pre_hold_status || "quote_sent_to_ho";
    await updateMutation.mutateAsync({
      id: quoteId,
      data: {
        status: restoredStatus,
        exclude_from_reporting: false,
        pre_hold_status: null,
        hold_reason: null,
        hold_date: null,
        status_history: [
          ...(quote.status_history || []),
          {
            entry_type: "status_change",
            status: restoredStatus,
            changed_by: currentUser.email,
            changed_at: now,
            reason: "Restored from Boneyard â€” re-included in SLA & revenue reporting"
          }
        ]
      }
    });
    toast.success("Quote restored to production and re-included in reporting");
  };

  // When a quote reaches a successful milestone, auto-close any rejected sibling versions
  // and write a "resolved" QuoteReview entry summarizing what fixed things.
  const closeRejectedSiblings = async (successfulQuote, successStatus) => {
    const currentUser = await base44.auth.me();
    const siteId = successfulQuote.site_id;

    // Fetch all versions for this site (site_id is the reliable grouping key)
    const allVersions = (await getQuotes()).filter(q => q.site_id === siteId);

    const rejectedSiblings = allVersions.filter(q => q.status === "rejected" && q.id !== successfulQuote.id);

    // Build a summary of what changed between the rejected version and the successful one
    const changesNotes = [];
    if (successfulQuote.scope_of_work) changesNotes.push(`Scope of work: "${successfulQuote.scope_of_work.slice(0, 120)}${successfulQuote.scope_of_work.length > 120 ? "â€¦" : ""}"`);
    if (successfulQuote.total) changesNotes.push(`Final total: $${successfulQuote.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    if (successfulQuote.version_number) changesNotes.push(`Approved version: v${successfulQuote.version_number}`);

    const successLabel = {
      quote_sent_to_ho: "sent to HO",
      ho_approved_invoice_required: "HO approved",
      invoiced: "invoiced",
      invoice_paid: "invoice paid",
    }[successStatus] || successStatus;

    const coachingNote = `This quote was revised and successfully ${successLabel} on ${new Date().toLocaleDateString()}.\n\n${changesNotes.join("\n")}\n\nEarlier rejected version(s) for this site are now closed â€” no further review action needed.`;

    await Promise.allSettled(
      rejectedSiblings.map(async (rejected) => {
        // Check if a review already exists for this rejected quote
        const existing = await getReviews(rejected.id);
        const payload = {
          quote_id: rejected.id,
          quote_number: rejected.quote_number,
          site_id: rejected.site_id,
          reviewer_email: currentUser.email,
          rejection_reason_snapshot: rejected.rejection_reason,
          coaching_notes: coachingNote,
          recommended_edits: `No further edits needed â€” a later version (v${successfulQuote.version_number || "?"}) was ${successLabel}.`,
          review_status: "completed",
          completed_date: new Date().toISOString(),
        };
        if (existing.length > 0) {
          // Update the first existing review to completed with the resolution note
          await updateReview(existing[0].id, payload);
        } else {
          await createReview(payload);
        }
      })
    );
  };

  const handleChangeOwner = async () => {
    if (!newOwner) return;
    await updateMutation.mutateAsync({
      id: quoteId,
      data: { owner_email: newOwner }
    });
    toast.success("Quote owner updated successfully");
    setShowChangeOwnerDialog(false);
    setNewOwner("");
  };

  // Effective owner: prefer owner_email (reassigned) over created_by (original creator)
  const effectiveOwner = quote?.owner_email || quote?.created_by;
  const isOriginalCreator = quote?.created_by_id === user?.id;
  const canEditQuote = isOriginalCreator || isApprover || isAdmin;
  const canViewVersionHistory = roles.includes("approver");
  const canRestoreVersion = roles.includes("approver");

  const { data: versionHistory = [] } = useQuery({
    queryKey: ["quoteVersions", quote?.parent_quote_id || quote?.id],
    queryFn: async () => {
      if (!quote) return [];
      const parentId = quote.parent_quote_id || quote.id;
      const allQuotes = await getQuotes();
      return allQuotes.filter(q => 
        (q.parent_quote_id === parentId || q.id === parentId)
      );
    },
    enabled: !!quote
  });

  const handleRestoreVersion = async (version) => {
    await bulkUpdateQuotes(
      versionHistory.map((item) => ({
        id: item.id,
        is_current_version: item.id === version.id
      }))
    );
    queryClient.invalidateQueries({ queryKey: ["quotes"] });
    queryClient.invalidateQueries({ queryKey: ["quoteVersions", quote?.parent_quote_id || quote?.id] });
    toast.success(`Version ${version.version_number || 1} restored`);
    navigate(createPageUrl(`QuoteDetails?id=${version.id}`));
  };

  const handleDownloadPDF = async () => {
    try {
      const pdfBlob = await generateQuotePDF(quote, versionHistory);
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `quote-${quote.site_id || quote.quote_number}-v${quote.version_number || 1}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded successfully");
    } catch (error) {
      toast.error("Failed to generate PDF");
      console.error(error);
    }
  };

  const handleDownloadCustomerPDF = async () => {
    try {
      const pdfBlob = await generateCustomerQuotePDF(quote);
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `customer-copy-${quote.site_id || quote.quote_number}-v${quote.version_number || 1}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Customer copy PDF downloaded successfully");
    } catch (error) {
      toast.error("Failed to generate customer copy PDF");
      console.error(error);
    }
  };

  const handleExportQuote = () => {
    const quoteData = {
      quote_number: quote.quote_number,
      site_id: quote.site_id,
      client_name: quote.client_name,
      client_email: quote.client_email,
      address: quote.address,
      scope_of_work: quote.scope_of_work,
      fst_count: quote.fst_count,
      status: quote.status,
      items: quote.items,
      subtotal: quote.subtotal,
      discount_percent: quote.discount_percent,
      tax_percent: quote.tax_percent,
      total: quote.total,
      notes: quote.notes,
      valid_until: quote.valid_until,
      created_date: quote.created_date,
      approved_date: quote.approved_date
    };
    
    const dataStr = JSON.stringify(quoteData, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `quote-${quote.site_id || quote.quote_number}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Quote not found</h2>
          <Link to={createPageUrl("Quotes")}>
            <Button className="mt-4">Back to Quotes</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col gap-2 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <Link to={createPageUrl("Quotes")}>
                <Button variant="ghost" className="text-slate-600 mb-1">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Quotes
                </Button>
              </Link>
              <div className="flex items-center gap-4 flex-wrap">
                <h1 className="text-3xl font-bold text-slate-900">{quote.site_id || "No Site ID"}</h1>
                <StatusBadge status={quote.status} size="large" />
                <Button 
                  onClick={handleDownloadPDF}
                  variant="outline"
                  className="border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
                <Button 
                  onClick={handleDownloadCustomerPDF}
                  variant="outline"
                  className="border-purple-200 text-purple-700 hover:bg-purple-50"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Customer Copy
                </Button>
                <span className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg">
                  v{quote.version_number || 1}
                </span>
              </div>
              <p className="text-slate-600 mt-1">{quote.quote_number}</p>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap gap-2 justify-center">
            {(isAdmin || isApprover) && (
              <Select value={quote.status} onValueChange={handleStatusChange} disabled={updateMutation.isPending}>
                <SelectTrigger className="w-[240px] border-slate-300">
                  <SelectValue placeholder="Change status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft_without_internal">Quote Draft</SelectItem>
                  <SelectItem value="draft_without_fst">Quote Missing Details</SelectItem>
                  <SelectItem value="submitted">Quote Pending Approval</SelectItem>
                  <SelectItem value="approved">Quote Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="quote_sent_to_ho">Quote Sent to HO</SelectItem>
                  <SelectItem value="ho_approved_invoice_required">HO Approved, Invoice Required</SelectItem>
                  <SelectItem value="ho_rejected">HO Rejected</SelectItem>
                  <SelectItem value="invoiced">Quote Pending Payment</SelectItem>
                  <SelectItem value="invoice_paid">Invoice Paid</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="on_hold">On Hold (Boneyard)</SelectItem>
                </SelectContent>
              </Select>
            )}
            {quote.status === "approved" && canEditQuote && (
              <>
                <Button 
                  onClick={handleExportQuote}
                  variant="outline"
                  className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export JSON
                </Button>
                {isApprover && (
                  <Button 
                    variant="outline"
                    onClick={() => setShowRejectDialog(true)}
                    className="border-rose-200 text-rose-600 hover:bg-rose-50"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                )}
                <Button 
                  onClick={handleMarkQuoteSentToHO}
                  disabled={updateMutation.isPending}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send to HO
                </Button>
              </>
            )}
            {quote.status === "quote_sent_to_ho" && canEditQuote && (
              <>
                {canEditQuote && (
                  <Link to={createPageUrl(`EditQuote?id=${quote.id}`)}>
                    <Button variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50">
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit Quote
                    </Button>
                  </Link>
                )}
                {canEditQuote && (
                  <Button
                    onClick={() => setShowApproveDialog(true)}
                    disabled={updateMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Re-Approve
                  </Button>
                )}
                <Button 
                  variant="outline"
                  onClick={() => setShowHORejectDialog(true)}
                  className="border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  HO Rejected
                </Button>
                <Button 
                  onClick={handleMarkHOApproved}
                  disabled={updateMutation.isPending}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  HO Approved
                </Button>
              </>
            )}
            {quote.status === "ho_approved_invoice_required" && (isAdmin || isApprover) && (
              <>
                <Button 
                  onClick={handleMarkInvoiced}
                  disabled={updateMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Receipt className="w-4 h-4 mr-2" />
                  Mark as Invoiced
                </Button>
              </>
            )}
            {quote.status === "invoiced" && isSubmitter && canEditQuote && (
              <>
                <Button 
                  onClick={() => { setPaidDate(format(new Date(), "yyyy-MM-dd")); setStripeTransactionId(""); setStripeInvoiceId(""); setPaymentConfirmed(false); setShowPaidDialog(true); }}
                  disabled={updateMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Mark as Paid
                </Button>
              </>
            )}
            {quote.status === "invoice_paid" && canEditQuote && (
              <Button
                onClick={handleMarkScheduled}
                disabled={updateMutation.isPending}
                className="bg-teal-600 hover:bg-teal-700"
              >
                <CalendarCheck className="w-4 h-4 mr-2" />
                Mark as Scheduled
              </Button>
            )}
            {canEditQuote && (
              <Button
                variant="outline"
                onClick={() => saveCopyMutation.mutate()}
                disabled={saveCopyMutation.isPending}
                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              >
                <CopyPlus className="w-4 h-4 mr-2" />
                {saveCopyMutation.isPending ? "Saving Copy..." : "Save Copy as Option"}
              </Button>
            )}
            {(quote.status === "draft_without_internal" || quote.status === "draft_without_fst" || quote.status === "draft") && canEditQuote && (
              <>
                <Link to={createPageUrl(`EditQuote?id=${quote.id}`)}>
                  <Button variant="outline">
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                </Link>
                <Button 
                  onClick={handleSubmit}
                  disabled={updateMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Submit for Approval
                </Button>
              </>
            )}
            {quote.status === "rejected" && canEditQuote && (
              <Link to={createPageUrl(`EditQuote?id=${quote.id}`)}>
                <Button className="bg-indigo-600 hover:bg-indigo-700">
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit & Resubmit
                </Button>
              </Link>
            )}
            {(quote.status === "submitted" || quote.status === "approved") && canEditQuote && (
              <Button
                variant="outline"
                onClick={handlePullBackToDraft}
                disabled={updateMutation.isPending}
                className="border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Pull Back to Draft
              </Button>
            )}
            {quote.status === "submitted" && isApprover && (
              <>
                <Button 
                  variant="outline" 
                  onClick={() => setShowRejectDialog(true)}
                  className="border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button 
                  onClick={() => setShowApproveDialog(true)}
                  disabled={updateMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve
                </Button>
              </>
            )}
            {quote.status === "on_hold" ? (
              canEditQuote && (
                <Button
                  onClick={handleRestoreFromBoneyard}
                  disabled={updateMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <ArchiveRestore className="w-4 h-4 mr-2" />
                  Restore from Boneyard
                </Button>
              )
            ) : (
              canEditQuote && (
                <Button
                  variant="outline"
                  onClick={() => { setBoneyardReason(""); setShowBoneyardDialog(true); }}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                  <Archive className="w-4 h-4 mr-2" />
                  Move to Boneyard
                </Button>
              )
            )}
            {canEditQuote && (
              <Button
                variant="outline"
                onClick={() => setShowFollowUpDialog(true)}
                className="border-teal-200 text-teal-700 hover:bg-teal-50"
              >
                <MessageSquarePlus className="w-4 h-4 mr-2" />
                Log Follow-Up
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => { setNewOwner(effectiveOwner || ""); setShowChangeOwnerDialog(true); }}
                className="border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                <UserCog className="w-4 h-4 mr-2" />
                Change Owner
              </Button>
            )}
            {isAdmin ? (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setShowDeleteDialog(true)}
                className="text-slate-400 hover:text-rose-600"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            ) : (
              !deletionRequest && (
                <Button 
                  variant="outline"
                  onClick={() => setShowDeleteRequestDialog(true)}
                  className="border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Request Deletion
                </Button>
              )
            )}
          </div>
        </div>


        {/* On Hold / Boneyard Banner */}
        {quote.status === "on_hold" && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-4 mb-6 bg-amber-50 border-amber-300">
              <div className="flex items-start gap-3">
                <Archive className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-800">This quote is in the Boneyard (On Hold)</p>
                  <p className="text-amber-700 text-sm mt-0.5">
                    It is <strong>excluded from all SLA and revenue reporting</strong> until restored to production.
                  </p>
                  {quote.hold_reason && (
                    <p className="text-amber-600 text-sm mt-1 italic">Reason: {quote.hold_reason}</p>
                  )}
                  {quote.hold_date && (
                    <p className="text-amber-500 text-xs mt-1">
                      Held since {format(new Date(quote.hold_date), "MMM d, yyyy")}
                      {quote.pre_hold_status && ` Â· was "${quote.pre_hold_status.replace(/_/g, " ")}"`}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Rejection Reason Alert */}
        {quote.status === "rejected" && quote.rejection_reason && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="p-4 mb-6 bg-rose-50 border-rose-200">
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-rose-600 mt-0.5" />
                <div>
                  <p className="font-medium text-rose-800">Rejection Reason</p>
                  <p className="text-rose-700 mt-1">{quote.rejection_reason}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* HO Rejection Reason Alert */}
        {quote.status === "ho_rejected" && quote.ho_rejection_reason && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="p-4 mb-6 bg-red-50 border-red-200">
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800">HO Rejection Reason</p>
                  <p className="text-red-700 mt-1">{quote.ho_rejection_reason}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* Deletion Request Pending Alert */}
        {deletionRequest && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="p-4 mb-6 bg-amber-50 border-amber-200">
              <div className="flex items-start gap-3">
                <Trash2 className="w-5 h-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">Deletion Request Pending</p>
                  <p className="text-amber-700 mt-1">
                    A deletion request has been submitted and is awaiting admin review.
                  </p>
                  <p className="text-sm text-amber-600 mt-2">Reason: {deletionRequest.reason}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quote Info */}
          <Card className="p-6 border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Quote Details</h3>
            <div className="space-y-4">
              {quote.site_id && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Hash className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Site ID</p>
                    <p className="font-medium text-slate-900">{quote.site_id}</p>
                  </div>
                </div>
              )}
              {quote.case_number && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Case Number</p>
                    <p className="font-medium text-slate-900">{quote.case_number}</p>
                  </div>
                </div>
              )}
              {quote.picklist && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <ClipboardList className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Project Picklist</p>
                    <p className="font-medium text-slate-900">{quote.picklist}</p>
                  </div>
                </div>
              )}
              {quote.fst_count > 0 && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Users className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">FSTs Needed</p>
                    <p className="font-medium text-slate-900">{quote.fst_count}</p>
                  </div>
                </div>
              )}
              {quote.miles_traveled > 0 && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Hash className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Miles Traveled</p>
                    <p className="font-medium text-slate-900">{quote.miles_traveled} mi @ ${quote.mileage_rate || 0.73}/mi</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Created</p>
                  <p className="font-medium text-slate-900">
                    {format(new Date(quote.created_date), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
              {quote.valid_until && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Valid Until</p>
                    <p className="font-medium text-slate-900">
                      {format(new Date(quote.valid_until), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
              )}
              {quote.paid_at_date && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Paid At</p>
                    <p className="font-medium text-slate-900">{format(new Date(quote.paid_at_date), "MMM d, yyyy")}</p>
                    <p className="text-xs text-slate-500">Stripe transaction: {quote.stripe_transaction_id || "Not recorded"}</p>
                    <p className="text-xs text-slate-500">Stripe invoice: {quote.stripe_invoice_id || "Not recorded"}</p>
                  </div>
                </div>
              )}
              {quote.quote_requester && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-500">FST Requester</p>
                    <p className="font-medium text-slate-900 break-words">{quote.quote_requester}</p>
                  </div>
                </div>
              )}
              {(quote.owner_email || quote.created_by) && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-500">{quote.owner_email ? "Owner" : "Created By"}</p>
                    <p className="font-medium text-slate-900 break-all">{effectiveOwner}</p>
                    {quote.owner_email && quote.created_by && quote.owner_email !== quote.created_by && (
                      <p className="text-xs text-slate-400">Originally by {quote.created_by}</p>
                    )}
                  </div>
                </div>
              )}
              {quote.last_follow_up_date && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center">
                    <MessageSquarePlus className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Last Follow-Up</p>
                    <p className="font-medium text-slate-900">
                      {format(new Date(quote.last_follow_up_date), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
              )}
              {isAdmin && (
                <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                  <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                    <EyeOff className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-500">Exclude from Reporting</p>
                    <p className="text-xs text-slate-400">Hide from SLA & Revenue data</p>
                  </div>
                  <Switch
                    checked={!!quote.exclude_from_reporting}
                    onCheckedChange={(checked) => {
                      updateMutation.mutate({ id: quoteId, data: { exclude_from_reporting: checked } });
                      toast.success(checked ? "Quote excluded from reporting" : "Quote included in reporting");
                    }}
                  />
                </div>
              )}

              {/* Pre-Approval â€” always visible as a status indicator, editable only by authorized users */}
              <div className={`flex items-center gap-3 pt-2 border-t border-slate-100 rounded-lg px-2 py-1 ${quote.pre_approved ? "bg-emerald-50" : "bg-rose-50"}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${quote.pre_approved ? "bg-emerald-100" : "bg-rose-100"}`}>
                  <CheckCircle className={`w-4 h-4 ${quote.pre_approved ? "text-emerald-600" : "text-rose-400"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${quote.pre_approved ? "text-emerald-700" : "text-rose-600"}`}>
                    {quote.pre_approved ? "Pre-Approved" : "Not Pre-Approved"}
                  </p>
                  {quote.pre_approved && quote.pre_approved_by ? (
                    <p className="text-xs text-emerald-600 truncate">by {quote.pre_approved_by}</p>
                  ) : (
                    <p className="text-xs text-rose-400">Required before submission</p>
                  )}
                </div>
                {canPreApprove && (
                  <Switch
                    checked={!!quote.pre_approved}
                    onCheckedChange={handleTogglePreApproval}
                    disabled={updateMutation.isPending}
                  />
                )}
              </div>
            </div>
          </Card>

          {/* Line Items */}
          <Card className="p-6 border-slate-200 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Line Items</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyPartList}
                className="border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                <ClipboardList className="w-4 h-4 mr-2" />
                Copy Part List
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-2 text-sm font-medium text-slate-600">Item</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-slate-600">Qty</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-slate-600">Unit Price</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-slate-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.items?.map((item, index) => (
                    <tr key={index} className="border-b border-slate-100">
                      <td className="py-3 px-2">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        {item.description && (
                          <p className="text-sm text-slate-500">{item.description}</p>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right text-slate-700">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="py-3 px-2 text-right text-slate-700">
                        ${item.unit_price?.toFixed(2)}
                        {item.upcharge && <span className="text-xs text-amber-600 block">+40%</span>}
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-slate-900">
                        ${item.total?.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            {(() => {
              const {
                itemsSubtotal,
                laborCost,
                travelCost,
                mileageCost,
                subtotal,
                discountAmount,
                combinedTaxRate,
                taxableAfterDiscount,
                taxAmount,
                afterDiscount,
                total: calculatedTotal
              } = calculateQuoteTotals(quote);
              const hasDiscount = discountAmount > 0;
              const hasTax = combinedTaxRate > 0;


              return (
                <div className="mt-6 pt-4 border-t border-slate-200 space-y-2">
                  <div className="flex justify-between text-slate-600">
                    <span>Line Items Subtotal</span>
                    <span>${itemsSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>
                      {quote.labor_mode === "flat"
                        ? `Labor (Flat fee)`
                        : `Labor (${quote.fst_count || 0} FST${(quote.fst_count || 0) > 1 ? "s" : ""} — ${quote.labor_hours || 0} hrs @ $${quote.labor_rate || 125}/hr)`}
                    </span>
                    <span>${laborCost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Travel ({quote.travel_hours || 0} hrs @ ${quote.travel_rate || 65}/hr)</span>
                    <span>${travelCost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Mileage ({quote.miles_traveled || 0} mi @ ${quote.mileage_rate || 0.73}/mi)</span>
                    <span>${mileageCost.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-100 text-slate-700 font-medium">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  {hasDiscount && (
                    <div className="flex justify-between text-slate-600">
                      <span>
                        {quote.discount_type === "flat"
                          ? `Discount ($${discountAmount.toFixed(2)} off)`
                          : `Discount (${quote.discount_percent}%)`}
                      </span>
                      <span>-${discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {hasTax && (
                    <div className="flex justify-between text-slate-600">
                      <span>Taxable Subtotal <span className="text-xs text-slate-400">(taxable items only)</span></span>
                      <span>${taxableAfterDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  {hasTax && (
                    <div className="flex justify-between text-slate-600">
                      <span>Taxes ({combinedTaxRate}% combined)</span>
                      <span>+${taxAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-slate-200">
                    <span className="text-lg font-semibold text-slate-900">Total</span>
                    <span className="text-2xl font-bold text-indigo-600">
                      ${calculatedTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </Card>
        </div>

        {/* Scope of Work */}
        {quote.scope_of_work && (
          <Card className="p-6 mt-6 border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Scope of Work</h3>
            <p className="text-slate-600 whitespace-pre-wrap">{quote.scope_of_work}</p>
          </Card>
        )}

        {/* Notes */}
        {quote.notes && (
          <Card className="p-6 mt-6 border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Notes & Terms</h3>
            <p className="text-slate-600 whitespace-pre-wrap">{quote.notes}</p>
          </Card>
        )}

        {canViewVersionHistory && (
          <>
            {/* Version Comparison with Rejection History */}
            <QuoteVersionComparison quote={quote} />

            {/* Version History */}
            <QuoteVersionHistory
              quote={quote}
              canRestore={canRestoreVersion}
              onRestore={handleRestoreVersion}
            />
          </>
        )}

        {/* Follow-Up History */}
        <FollowUpHistory quoteId={quoteId} />

        <QuoteActivityLog quoteId={quoteId} />

        {/* Quote History */}
        {quote.status_history && quote.status_history.length > 0 && (
          <Card className="p-6 mt-6 border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Status History</h3>
            <div className="space-y-4">
              {quote.status_history.map((entry, index) => {
                const isFollowUp = entry.entry_type === "follow_up";
                return (
                  <div key={index} className="flex gap-4 pb-4 border-b border-slate-100 last:border-0 last:pb-0">
                    <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${isFollowUp ? "bg-teal-500" : "bg-indigo-600"}`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        {isFollowUp ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                            <MessageSquarePlus className="w-3 h-3" /> Follow-Up
                          </span>
                        ) : (
                          <StatusBadge status={entry.status} size="sm" />
                        )}
                        <span className="text-xs text-slate-500">
                          {format(new Date(entry.changed_at), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">{isFollowUp ? "Logged by" : "Changed by"}: {entry.changed_by}</p>
                      {entry.reason && (
                        <p className="text-sm text-slate-500 mt-1 italic">{entry.reason}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Quote</DialogTitle>
            <DialogDescription>
              Add an optional note to record with this approval.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={approveNote}
            onChange={(e) => setApproveNote(e.target.value)}
            placeholder="Optional approval note..."
            rows={4}
            maxLength={5000}
          />
          <p className="text-xs text-slate-500 mt-1">{approveNote.length} / 5000 characters</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowApproveDialog(false); setApproveNote(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={updateMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Quote</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this quote.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Enter rejection reason..."
            rows={4}
            maxLength={5000}
          />
          <p className="text-xs text-slate-500 mt-1">
            {rejectionReason.length} / 5000 characters
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleReject}
              disabled={!rejectionReason.trim()}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Reject Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HO Reject Dialog */}
      <Dialog open={showHORejectDialog} onOpenChange={setShowHORejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>HO Reject Quote</DialogTitle>
            <DialogDescription>
              Please provide a reason for HO rejecting this quote.
            </DialogDescription>
          </DialogHeader>
          <Select value={decisionCategory} onValueChange={setDecisionCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="no_customer_response">No customer response</SelectItem>
              <SelectItem value="cost">Cost</SelectItem>
              <SelectItem value="scheduling">Scheduling</SelectItem>
              <SelectItem value="homeowner_cancelled">Homeowner cancelled</SelectItem>
              <SelectItem value="homeowner_declined">Homeowner declined</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            value={hoRejectionReason}
            onChange={(e) => setHoRejectionReason(e.target.value)}
            placeholder="Enter HO rejection reason..."
            rows={4}
            maxLength={5000}
          />
          <p className="text-xs text-slate-500 mt-1">
            {hoRejectionReason.length} / 5000 characters
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHORejectDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleHOReject}
              disabled={!hoRejectionReason.trim()}
              className="bg-rose-600 hover:bg-rose-700"
            >
              HO Reject Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quote</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this quote? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => deleteMutation.mutate(quoteId)}
              disabled={deleteMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Delete Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Boneyard Dialog */}
      <Dialog open={showBoneyardDialog} onOpenChange={setShowBoneyardDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to Boneyard</DialogTitle>
            <DialogDescription>
              This quote will be placed on hold and <strong>excluded from SLA &amp; revenue reporting</strong> until you restore it.
              Use this when waiting on a long-term homeowner decision.
            </DialogDescription>
          </DialogHeader>
          <Select value={decisionCategory} onValueChange={setDecisionCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="no_customer_response">No customer response</SelectItem>
              <SelectItem value="cost">Cost</SelectItem>
              <SelectItem value="scheduling">Scheduling</SelectItem>
              <SelectItem value="homeowner_cancelled">Homeowner cancelled</SelectItem>
              <SelectItem value="homeowner_declined">Homeowner declined</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            value={boneyardReason}
            onChange={(e) => setBoneyardReason(e.target.value)}
            placeholder="Optional reason (e.g. 'HO needs 60+ days to decide â€” financing pending')"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBoneyardDialog(false)}>Cancel</Button>
            <Button
              onClick={handleMoveToBoneyard}
              disabled={updateMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              <Archive className="w-4 h-4 mr-2" />
              Move to Boneyard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Follow-Up Dialog */}
      <Dialog open={showFollowUpDialog} onOpenChange={setShowFollowUpDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Follow-Up</DialogTitle>
            <DialogDescription>
              Record that you've followed up on this quote. This updates the last-touched date and adds an entry to the history.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
            placeholder="Optional note (e.g. 'Called HO, still deciding â€” check back in 2 weeks')"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFollowUpDialog(false)}>Cancel</Button>
            <Button
              onClick={handleLogFollowUp}
              disabled={updateMutation.isPending}
              className="bg-teal-600 hover:bg-teal-700"
            >
              <MessageSquarePlus className="w-4 h-4 mr-2" />
              Log Follow-Up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Owner Dialog */}
      <Dialog open={showChangeOwnerDialog} onOpenChange={setShowChangeOwnerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Quote Owner</DialogTitle>
            <DialogDescription>
              Select a new owner for this quote. The current owner is <strong>{effectiveOwner}</strong>.
            </DialogDescription>
          </DialogHeader>
          <Select value={newOwner} onValueChange={setNewOwner}>
            <SelectTrigger>
              <SelectValue placeholder="Select new owner..." />
            </SelectTrigger>
            <SelectContent>
              {allUsers.map(u => (
                <SelectItem key={u.id} value={u.email}>
                  {u.full_name ? `${u.full_name} (${u.email})` : u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangeOwnerDialog(false)}>Cancel</Button>
            <Button
              onClick={handleChangeOwner}
              disabled={!newOwner || updateMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Update Owner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Invoice Paid Dialog */}
      <Dialog open={showPaidDialog} onOpenChange={setShowPaidDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Invoice as Paid</DialogTitle>
            <DialogDescription>
              Confirm the homeowner has completed payment, then select the payment date for revenue reporting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stripeTransactionId">Stripe Transaction ID</Label>
              <Input id="stripeTransactionId" value={stripeTransactionId} onChange={(e) => setStripeTransactionId(e.target.value)} placeholder="e.g., ch_..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stripeInvoiceId">Stripe Invoice ID</Label>
              <Input id="stripeInvoiceId" value={stripeInvoiceId} onChange={(e) => setStripeInvoiceId(e.target.value)} placeholder="e.g., in_..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paidDate">Paid At Date</Label>
              <Input
                id="paidDate"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <Checkbox checked={paymentConfirmed} onCheckedChange={setPaymentConfirmed} className="mt-0.5" />
              <span>I confirm the homeowner has completed payment.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaidDialog(false)}>Cancel</Button>
            <Button
              onClick={handleMarkInvoicePaid}
              disabled={!paidDate || !stripeTransactionId.trim() || !stripeInvoiceId.trim() || !paymentConfirmed || updateMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Mark as Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Deletion Dialog */}
      <Dialog open={showDeleteRequestDialog} onOpenChange={setShowDeleteRequestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Quote Deletion</DialogTitle>
            <DialogDescription>
              Submit a request to delete this quote. An admin will review and approve/reject your request.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={deletionReason}
            onChange={(e) => setDeletionReason(e.target.value)}
            placeholder="Please explain why this quote should be deleted..."
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteRequestDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleRequestDeletion}
              disabled={!deletionReason.trim() || requestDeletionMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function QuoteDetails() {
  return (
    <RoleGuard>
      <QuoteDetailsContent />
    </RoleGuard>
  );
}