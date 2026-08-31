import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { createQuote, getCurrentUser, getProducts, getQuotes, isLocalDataSource } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import QuoteForm from "@/components/quotes/QuoteForm";
import RoleGuard, { useUserRole } from "@/components/auth/RoleGuard";
import { toast } from "sonner";

function CreateQuoteContent() {
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showPreview, setShowPreview] = useState(false);
  const [quoteData, setQuoteData] = useState(null);
  const [quoteNumber] = useState(() => {
    const ts = Date.now().toString().slice(-7);
    const rand = Math.floor(Math.random() * 900 + 100); // 3-digit random
    return `Q-${ts}${rand}`;
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

  const saveDraftMutation = useMutation({
    mutationFn: async (data) => {
      const user = await getCurrentUser();
      return await createQuote({
        ...data,
        quote_number: quoteNumber,
        status: "draft",
        status_history: [{
          status: "draft",
          changed_by: user.email,
          changed_at: new Date().toISOString(),
          reason: null
        }]
      });
    },
    onSuccess: (newQuote) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      navigate(createPageUrl(`QuoteDetails?id=${newQuote.id}`));
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const user = await getCurrentUser();
      const newQuote = await createQuote({
        ...data,
        quote_number: quoteNumber,
        status: "submitted",
        submitted_date: new Date().toISOString(),
        status_history: [{
          status: "submitted",
          changed_by: user.email,
          changed_at: new Date().toISOString(),
          reason: null
        }]
      });
      
      if (isLocalDataSource) return newQuote;

      // Send notification emails
      try {
        const distributions = await base44.entities.EmailDistribution.filter({
          email_type: "quote_submitted",
          is_active: true
        });
        
        console.log('📧 Create Quote - Found distributions:', distributions.length, distributions);
        console.log('📧 Quote creator:', newQuote.created_by);
        
        const emailResults = await Promise.allSettled([
          ...distributions.map(dist =>
            base44.integrations.Core.SendEmail({
              to: dist.recipient_email,
              subject: `New Quote Submitted: ${newQuote.site_id || newQuote.quote_number}`,
              body: `A new quote has been submitted for approval.\n\nSite ID: ${newQuote.site_id}\nTotal: $${newQuote.total.toFixed(2)}\n\nPlease review and approve/reject in the system.`
            }).then(() => ({ email: dist.recipient_email, success: true }))
              .catch(err => ({ email: dist.recipient_email, success: false, error: err }))
          ),
          ...(newQuote.created_by ? [
            base44.integrations.Core.SendEmail({
              to: newQuote.created_by,
              subject: `Quote Submitted Successfully: ${newQuote.site_id || newQuote.quote_number}`,
              body: `Your quote has been submitted for approval.\n\nSite ID: ${newQuote.site_id}\nTotal: $${newQuote.total.toFixed(2)}\n\nYou will be notified once it's reviewed.`
            }).then(() => ({ email: newQuote.created_by, success: true }))
              .catch(err => ({ email: newQuote.created_by, success: false, error: err }))
          ] : [])
        ]);
        
        console.log('📧 Email results:', emailResults);
        
        const failedEmails = emailResults
          .filter(result => result.status === 'fulfilled' && !result.value.success)
          .map(result => result.value.email);
        
        const rejectedEmails = emailResults
          .filter(result => result.status === 'rejected')
          .map(result => result.reason);
        
        console.log('📧 Failed emails:', failedEmails);
        console.log('📧 Rejected emails:', rejectedEmails);
        
        if (failedEmails.length > 0) {
          toast.error(`Failed to send notifications to: ${failedEmails.join(', ')}`);
        } else if (rejectedEmails.length > 0) {
          toast.error(`Email sending rejected: ${rejectedEmails.length} errors`);
          console.error('Email rejection details:', rejectedEmails);
        } else {
          toast.success('Quote submitted and notifications sent successfully');
        }
      } catch (error) {
        console.error('📧 Email error:', error);
        toast.error('Failed to send email notifications');
      }
      
      return newQuote;
    },
    onSuccess: (newQuote) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      navigate(createPageUrl(`QuoteDetails?id=${newQuote.id}`));
    }
  });

  const handlePreview = (data) => {
    setQuoteData(data);
    setShowPreview(true);
  };

  const handleSaveDraftFromForm = (data) => {
    saveDraftMutation.mutate(data);
  };

  const handleSaveDraft = () => {
    if (quoteData) {
      saveDraftMutation.mutate(quoteData);
    }
  };

  const handleSubmit = () => {
    if (quoteData) {
      createMutation.mutate(quoteData);
    }
  };

  if (showPreview && quoteData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <Button variant="ghost" onClick={() => setShowPreview(false)} className="text-slate-600 mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Edit
            </Button>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-slate-900">Preview Quote</h1>
              <span className="text-lg font-mono text-slate-500">{quoteNumber}</span>
            </div>
            <p className="text-slate-600 mt-1">Review before submitting for approval</p>
          </div>

          <Card className="p-8 border-slate-200 mb-6">
            <div className="space-y-6">
              {/* Site Info */}
              <div className="border-b border-slate-200 pb-6">
                <h2 className="text-xl font-semibold text-slate-900 mb-4">Site Information</h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500">Site ID</p>
                    <p className="font-medium text-slate-900">{quoteData.site_id}</p>
                  </div>
                  {quoteData.case_number && (
                    <div>
                      <p className="text-slate-500">Case Number</p>
                      <p className="font-medium text-slate-900">{quoteData.case_number}</p>
                    </div>
                  )}
                  {quoteData.picklist && (
                    <div>
                      <p className="text-slate-500">Picklist</p>
                      <p className="font-medium text-slate-900">{quoteData.picklist}</p>
                    </div>
                  )}
                  {quoteData.om_status && (
                    <div>
                      <p className="text-slate-500">O&M Status</p>
                      <p className="font-medium text-slate-900">{quoteData.om_status}</p>
                    </div>
                  )}
                  {quoteData.fst_count > 0 && (
                    <div>
                      <p className="text-slate-500">FSTs Needed</p>
                      <p className="font-medium text-slate-900">{quoteData.fst_count}</p>
                    </div>
                  )}
                  {quoteData.labor_hours > 0 && (
                    <div>
                      <p className="text-slate-500">Labor Hours</p>
                      <p className="font-medium text-slate-900">{quoteData.labor_hours}</p>
                    </div>
                  )}
                </div>
                {quoteData.scope_of_work && (
                  <div className="mt-4">
                    <p className="text-slate-500 text-sm">Scope of Work</p>
                    <p className="text-slate-900 mt-1">{quoteData.scope_of_work}</p>
                  </div>
                )}
              </div>

              {/* Line Items */}
              <div className="border-b border-slate-200 pb-6">
                <h2 className="text-xl font-semibold text-slate-900 mb-4">Line Items</h2>
                <div className="space-y-2">
                  {quoteData.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        {item.description && (
                          <p className="text-sm text-slate-500">{item.description}</p>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        <p className="text-slate-600">{item.quantity} × ${item.unit_price.toFixed(2)}</p>
                        <p className="font-semibold text-slate-900">${item.total.toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-3">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>${quoteData.subtotal.toFixed(2)}</span>
                </div>
                {quoteData.discount_percent > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Discount ({quoteData.discount_percent}%)</span>
                    <span>-${(quoteData.subtotal * (quoteData.discount_percent / 100)).toFixed(2)}</span>
                  </div>
                )}
                {quoteData.tax_percent > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Tax ({quoteData.tax_percent}%)</span>
                    <span>+${((quoteData.subtotal - (quoteData.subtotal * (quoteData.discount_percent / 100))) * (quoteData.tax_percent / 100)).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                  <span className="text-xl font-semibold text-slate-900">Total</span>
                  <span className="text-2xl font-bold text-indigo-600">${quoteData.total.toFixed(2)}</span>
                </div>
              </div>

              {quoteData.notes && (
                <div className="pt-6 border-t border-slate-200">
                  <h3 className="font-semibold text-slate-900 mb-2">Notes</h3>
                  <p className="text-slate-600 whitespace-pre-wrap">{quoteData.notes}</p>
                </div>
              )}
            </div>
          </Card>

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => setShowPreview(false)} className="flex-1 md:flex-none">
              Back to Edit
            </Button>
            <Button 
              type="button"
              variant="outline"
              onClick={handleSaveDraft} 
              disabled={saveDraftMutation.isPending || createMutation.isPending} 
              className="flex-1 md:flex-none"
            >
              {saveDraftMutation.isPending ? "Saving..." : "Save as Draft"}
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={createMutation.isPending || saveDraftMutation.isPending} 
              className="flex-1 md:flex-none bg-indigo-600 hover:bg-indigo-700"
            >
              {createMutation.isPending ? "Submitting..." : "Submit for Approval"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link to={createPageUrl("Quotes")}>
            <Button variant="ghost" className="text-slate-600 mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Quotes
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">Create New Quote</h1>
          <p className="text-slate-600 mt-1">Build a quote for your client</p>
        </div>

        <QuoteForm
          products={products}
          allQuotes={allQuotes}
          onSave={handlePreview}
          onSaveDraft={handleSaveDraftFromForm}
          onCancel={() => navigate(createPageUrl("Quotes"))}
          isLoading={saveDraftMutation.isPending}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}

export default function CreateQuote() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <CreateQuoteContent />
    </RoleGuard>
  );
}