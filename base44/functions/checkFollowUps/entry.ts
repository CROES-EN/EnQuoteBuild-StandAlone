import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.app_role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get all active follow-up configs
    const configs = await base44.asServiceRole.entities.FollowUpConfig.filter({
      is_active: true
    });

    // Get all current version quotes
    const quotes = await base44.asServiceRole.entities.Quote.filter({
      is_current_version: true
    });

    const now = new Date();
    const followUpsSent = [];

    for (const config of configs) {
      for (const quote of quotes) {
        let shouldSendFollowUp = false;
        let reason = '';

        // Check if follow-up already sent recently (within last 24 hours)
        const recentLogs = await base44.asServiceRole.entities.FollowUpLog.filter({
          quote_id: quote.id,
          config_id: config.id
        });
        
        const lastSent = recentLogs
          .map(log => new Date(log.sent_date))
          .sort((a, b) => b - a)[0];
        
        if (lastSent && (now - lastSent) < 24 * 60 * 60 * 1000) {
          continue; // Skip if sent in last 24 hours
        }

        // Check expiration approaching
        if (config.trigger_type === 'expiration_approaching' && quote.valid_until) {
          const expirationDate = new Date(quote.valid_until);
          const daysUntilExpiration = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
          
          if (daysUntilExpiration > 0 && daysUntilExpiration <= config.days_threshold) {
            shouldSendFollowUp = true;
            reason = `Quote expiring in ${daysUntilExpiration} days`;
          }
        }

        // Check status duration
        if (config.trigger_type === 'status_duration' && quote.status === config.status) {
          let statusDate;
          if (config.status === 'submitted' && quote.submitted_date) {
            statusDate = new Date(quote.submitted_date);
          } else if (config.status === 'quote_sent_to_ho' && quote.quote_sent_to_ho_date) {
            statusDate = new Date(quote.quote_sent_to_ho_date);
          }

          if (statusDate) {
            const daysInStatus = Math.floor((now - statusDate) / (1000 * 60 * 60 * 24));
            if (daysInStatus >= config.days_threshold) {
              shouldSendFollowUp = true;
              reason = `Quote in ${config.status} status for ${daysInStatus} days`;
            }
          }
        }

        if (shouldSendFollowUp) {
          // Prepare email recipients
          const recipients = config.recipient_emails || [];
          if (quote.created_by && !recipients.includes(quote.created_by)) {
            recipients.push(quote.created_by);
          }

          // Replace placeholders in email body
          const emailBody = config.email_body
            .replace('{quote_number}', quote.quote_number || quote.id)
            .replace('{site_id}', quote.site_id || '')
            .replace('{total}', `$${(quote.total || 0).toFixed(2)}`)
            .replace('{status}', quote.status)
            .replace('{reason}', reason);

          // Send emails
          for (const recipient of recipients) {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: recipient,
              subject: config.email_subject,
              body: emailBody
            });
          }

          // Log the follow-up
          await base44.asServiceRole.entities.FollowUpLog.create({
            quote_id: quote.id,
            config_id: config.id,
            sent_date: now.toISOString(),
            trigger_reason: reason,
            recipients,
            was_manual: false
          });

          followUpsSent.push({
            quote_id: quote.id,
            site_id: quote.site_id,
            reason
          });
        }
      }
    }

    return Response.json({
      success: true,
      follow_ups_sent: followUpsSent.length,
      details: followUpsSent
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});