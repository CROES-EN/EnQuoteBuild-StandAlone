import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const displayValue = (value) => {
      if (value === undefined || value === null) return '—';
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return text.length > 250 ? `${text.slice(0, 247)}...` : text;
    };
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const event = payload.event || {};
    const quote = payload.data || await base44.asServiceRole.entities.Quote.get(event.entity_id);
    if (!quote || event.type === 'delete') return Response.json({ logged: false });

    const changedFields = event.type === 'create' ? Object.keys(quote).filter(key => !['id', 'created_date', 'updated_date'].includes(key)) : (payload.changed_fields || []);
    const oldQuote = payload.old_data || {};
    const fieldChanges = changedFields.map(field => ({
      field,
      previous_value: event.type === 'create' ? '—' : displayValue(oldQuote[field]),
      new_value: displayValue(quote[field])
    }));
    const now = new Date();
    const latestHistory = quote.status_history?.[quote.status_history.length - 1];

    await base44.asServiceRole.entities.QuoteActivity.create({
      quote_id: quote.id,
      action: event.type === 'create' ? 'created' : 'updated',
      changed_fields: changedFields,
      field_changes: fieldChanges,
      performed_by: latestHistory?.changed_at === quote.updated_date ? latestHistory.changed_by : null,
      action_at: now.toISOString(),
      mountain_time: new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }).format(now)
    });
    return Response.json({ logged: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}