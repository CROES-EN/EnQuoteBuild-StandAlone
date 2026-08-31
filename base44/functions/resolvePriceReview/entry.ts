import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || !['admin', 'approver'].includes(user.role || user.app_role)) return Response.json({ error: 'Approver or admin access required' }, { status: 403 });
    const { reviewId, decision } = await req.json();
    if (!reviewId || !['confirm', 'dismiss'].includes(decision)) return Response.json({ error: 'A valid review decision is required' }, { status: 400 });
    let review;
    try {
      review = await base44.asServiceRole.entities.PriceReview.get(reviewId);
    } catch (_) {
      return Response.json({ error: 'This review is no longer pending' }, { status: 404 });
    }
    if (review.status !== 'pending') return Response.json({ error: 'This review is no longer pending' }, { status: 404 });
    if (decision === 'confirm') await base44.asServiceRole.entities.Product.update(review.product_id, { unit_price: review.retailer_price });
    await base44.asServiceRole.entities.PriceReview.update(reviewId, { status: decision === 'confirm' ? 'confirmed' : 'dismissed', reviewed_by: user.email, reviewed_date: new Date().toISOString() });
    return Response.json({ success: true, updatedPrice: decision === 'confirm' });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
});