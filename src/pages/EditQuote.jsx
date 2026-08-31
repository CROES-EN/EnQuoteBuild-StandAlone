import { base44 } from "@/api/base44Client";
import { createQuote, getCurrentUser, getProducts, getQuoteById, getQuotes, isLocalDataSource, updateQuote } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation} from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import QuoteForm from "@/components/quotes/QuoteForm";
import QuoteVersionHistory from "@/components/quotes/QuoteVersionHistory";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";

function EditQuoteContent() {
  const { isApprover, isAdmin, roles, user, isLoading: loadingUser } = useUserRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const quoteId = urlParams.get("id");

  const { data: quote, isLoading: loadingQuote } = useQuery({
    queryKey: ["quote", quoteId],
    queryFn: async () => {
      return getQuoteById(quoteId);
    },
    enabled: !!quoteId
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      return getProducts();
    },
  });

  const { data: allQuotes = [] } = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
    const quotes = await getQuotes();
      return quotes.filter(q => q.is_current_version !== false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const user = await getCurrentUser();
      
      // If editing a submitted, approved, or rejected quote, create a new version
      if (quote?.status !== "draft") {
        // Mark current version as not current
        await updateQuote(quoteId, {
          is_current_version: false
        });
        
        // Get the parent quote ID (either this quote's parent, or this quote itself if it's the original)
        const parentQuoteId = quote.parent_quote_id || quoteId;
        
        // Get all existing versions to determine the next version number
        const allVersions = (await getQuotes()).filter(q => q.id === parentQuoteId || q.parent_quote_id === parentQuoteId);
        
        const maxVersion = Math.max(...allVersions.map(v => v.version_number || 1));
        const newVersionNumber = maxVersion + 1;
        
        // Create new version
        const newQuote = await createQuote({
          ...data,
          parent_quote_id: parentQuoteId,
          version_number: newVersionNumber,
          is_current_version: true,
          status: "submitted",
          submitted_date: new Date().toISOString(),
          rejection_reason: null,
          status_history: [
            {
              status: "submitted",
              changed_by: user.email,
              changed_at: new Date().toISOString(),
              reason: `New version (v${newVersionNumber}) created from v${quote.version_number || 1}`
            }
          ]
        });
        
        if (isLocalDataSource) return newQuote;

        // Send notification emails
        try {
          const distributions = await base44.entities.EmailDistribution.filter({
            email_type: "quote_submitted",
            is_active: true
          });
          
          const emailResults = await Promise.allSettled([
            ...distributions.map(dist =>
              base44.integrations.Core.SendEmail({
                to: dist.recipient_email,
                subject: `Quote Updated (v${newVersionNumber}): ${newQuote.site_id || newQuote.quote_number}`,
                body: `A new version of a quote has been submitted for approval.\n\nSite ID: ${newQuote.site_id}\nVersion: ${newVersionNumber}\nTotal: $${newQuote.total.toFixed(2)}\n\nPlease review and approve/reject in the system.`
              }).then(() => ({ email: dist.recipient_email, success: true }))
                .catch(err => ({ email: dist.recipient_email, success: false }))
            ),
            ...(newQuote.created_by ? [
              base44.integrations.Core.SendEmail({
                to: newQuote.created_by,
                subject: `Quote Updated (v${newVersionNumber}): ${newQuote.site_id || newQuote.quote_number}`,
                body: `A new version of your quote has been submitted for approval.\n\nSite ID: ${newQuote.site_id}\nVersion: ${newVersionNumber}\nTotal: $${newQuote.total.toFixed(2)}\n\nYou will be notified once it's reviewed.`
              }).then(() => ({ email: newQuote.created_by, success: true }))
                .catch(err => ({ email: newQuote.created_by, success: false }))
            ] : [])
          ]);
          
          const failedEmails = emailResults
            .filter(result => result.status === 'fulfilled' && !result.value.success)
            .map(result => result.value.email);
          
          if (failedEmails.length > 0) {
            toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
          } else {
            toast.success(`Version ${newVersionNumber} created and notifications sent`);
          }
        } catch (error) {
          toast.error('Failed to send email notifications');
        }
        
        return newQuote;
      }
      
      // If it's a draft, just update it normally
      return updateQuote(quoteId, data);
    },
    onSuccess: (newQuote) => {
      queryClient.invalidateQueries({ queryKey: ["quote", quoteId] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      // Navigate to the new quote if a new version was created
      const targetQuoteId = newQuote?.id || quoteId;
      navigate(createPageUrl(`QuoteDetails?id=${targetQuoteId}`));
    }
  });

  const saveCopyMutation = useMutation({
    mutationFn: async (data) => {
      const currentUser = await getCurrentUser();
      const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
      return createQuote({
        ...data,
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
          reason: `Saved as a pricing option from ${quote?.quote_number || quote?.site_id}`
        }]
      });
    },
    onSuccess: (copiedQuote) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Quote copy created as a new pricing option");
      navigate(createPageUrl(`EditQuote?id=${copiedQuote.id}`));
    }
  });

  if (loadingQuote || loadingUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const canViewVersionHistory = roles.includes("approver");
  const isOriginalCreator = quote?.created_by_id === user?.id;
  const canEdit = isOriginalCreator || isApprover || isAdmin;

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Cannot Edit</h2>
          <p className="text-slate-600">Only the original quote creator, an approver, or an admin can edit this quote.</p>
          <Link to={createPageUrl(`QuoteDetails?id=${quoteId}`)}>
            <Button className="mt-4">Back to Quote</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link to={createPageUrl(`QuoteDetails?id=${quoteId}`)}>
            <Button variant="ghost" className="text-slate-600 mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Quote
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">Edit Quote</h1>
          <p className="text-slate-600 mt-1">{quote?.quote_number}</p>
        </div>

        <QuoteForm
          quote={quote}
          products={products}
          allQuotes={allQuotes}
          onSave={(data) => updateMutation.mutate(data)}
          onSaveCopy={(data) => saveCopyMutation.mutate(data)}
          onCancel={() => navigate(createPageUrl(`QuoteDetails?id=${quoteId}`))}
          isLoading={updateMutation.isPending || saveCopyMutation.isPending}
          isAdmin={isAdmin}
        />

        {/* Rejection notes */}
        {quote?.rejection_reason && (
          <Card className="p-5 border-rose-200 bg-rose-50 mt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-rose-800 mb-1">Internal Rejection Reason</p>
                <p className="text-rose-700 text-sm">{quote.rejection_reason}</p>
              </div>
            </div>
          </Card>
        )}
        {quote?.ho_rejection_reason && (
          <Card className="p-5 border-rose-200 bg-rose-50 mt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-rose-800 mb-1">HO Rejection Reason</p>
                <p className="text-rose-700 text-sm">{quote.ho_rejection_reason}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Version history */}
        {canViewVersionHistory && (
          <div className="mt-6">
            <QuoteVersionHistory quote={quote} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function EditQuote() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <EditQuoteContent />
    </RoleGuard>
  );
}