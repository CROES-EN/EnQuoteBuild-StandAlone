import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const action = body.action;

    if (action === 'getMyAlerts') {
      const alerts = await base44.asServiceRole.entities.QuoteAlert.filter({
        mentioned_email: user.email,
        is_resolved: false
      }, "-created_date", 200);
      return Response.json(alerts);
    }

    if (action === 'createMentions') {
      const { mentions, quote_id, site_id, message, priority } = body;
      if (!mentions || !Array.isArray(mentions) || mentions.length === 0) {
        return Response.json({ created: 0 });
      }
      const alerts = mentions.map((m) => ({
        quote_id,
        site_id: site_id || "",
        mentioned_email: m.email,
        mentioned_by: user.email,
        message: message || "",
        priority: priority || 'yellow',
        is_resolved: false,
      }));
      const result = await base44.asServiceRole.entities.QuoteAlert.bulkCreate(alerts);
      return Response.json({ created: alerts.length, data: result });
    }

    if (action === 'resolveMention') {
      const { alert_id } = body;
      if (!alert_id) return Response.json({ error: 'alert_id required' }, { status: 400 });
      await base44.asServiceRole.entities.QuoteAlert.update(alert_id, {
        is_resolved: true,
        resolved_date: new Date().toISOString(),
        resolved_by: user.email,
      });
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});