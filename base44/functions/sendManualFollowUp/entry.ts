import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { quote_id, email_subject, email_body, recipient_emails } = await req.json();

    if (!quote_id || !email_subject || !email_body || !recipient_emails || recipient_emails.length === 0) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get the quote
    const quotes = await base44.entities.Quote.list();
    const quote = quotes.find(q => q.id === quote_id);

    if (!quote) {
      return Response.json({ error: 'Quote not found' }, { status: 404 });
    }

    // Replace placeholders in email body
    const processedBody = email_body
      .replace('{quote_number}', quote.quote_number || quote.id)
      .replace('{site_id}', quote.site_id || '')
      .replace('{total}', `$${(quote.total || 0).toFixed(2)}`)
      .replace('{status}', quote.status);

    // Send emails
    const emailPromises = recipient_emails.map(recipient =>
      base44.integrations.Core.SendEmail({
        to: recipient,
        subject: email_subject,
        body: processedBody
      })
    );

    await Promise.all(emailPromises);

    // Log the follow-up
    await base44.entities.FollowUpLog.create({
      quote_id: quote.id,
      sent_date: new Date().toISOString(),
      trigger_reason: 'Manual follow-up',
      recipients: recipient_emails,
      was_manual: true,
      triggered_by: user.email
    });

    return Response.json({
      success: true,
      message: `Follow-up sent to ${recipient_emails.length} recipient(s)`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});