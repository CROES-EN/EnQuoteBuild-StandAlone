import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { quote_id, quote_number, site_id, rejection_reason, submitter_email } = body;

    if (!quote_id) {
      return Response.json({ error: 'quote_id is required' }, { status: 400 });
    }

    // Check if a pending review already exists for this quote
    const existing = await base44.asServiceRole.entities.QuoteReview.filter({ quote_id, review_status: 'pending' });
    if (existing.length > 0) {
      return Response.json({ message: 'Coaching review already exists', review: existing[0] });
    }

    // Create the QuoteReview record
    const review = await base44.asServiceRole.entities.QuoteReview.create({
      quote_id,
      quote_number: quote_number || '',
      site_id: site_id || '',
      rejection_reason_snapshot: rejection_reason || '',
      review_status: 'pending',
    });

    // Send notification email to managers/approvers
    const managers = await base44.asServiceRole.entities.EmailDistribution.filter({
      email_type: 'quote_rejected',
      is_active: true
    });

    const quoteLink = `${req.headers.get('origin') || 'https://app.base44.com'}/RejectedQuoteReview`;

    for (const mgr of managers) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: mgr.recipient_email,
        from_name: 'ENquote Coaching',
        subject: `Coaching Required: Quote ${quote_number || quote_id} Rejected`,
        body: `
A quote has been rejected and requires your coaching input.

Quote: ${quote_number || quote_id}
Site ID: ${site_id || 'N/A'}
Submitted by: ${submitter_email || 'Unknown'}
Rejection Reason: ${rejection_reason || 'See app for details'}

Please log in and add your coaching notes and recommended edits so the coordinator can correct and resubmit the quote.

${quoteLink}
        `.trim()
      });
    }

    return Response.json({ success: true, review });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});