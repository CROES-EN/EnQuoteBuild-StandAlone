import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const retailers = [
  ['homedepot.com', 'The Home Depot'], ['greentechrenewables.com', 'CED GreenTech Renewables'], ['enphase.com', 'Enphase Store'], ['standardelectricsupply.com', 'Standard Electric Supply'], ['soligent.net', 'Soligent'], ['baywa-re.com', 'BayWa r.e. Solar Distribution'], ['solarelectricsupply.com', 'Solar Electric Supply'], ['a1solarstore.com', 'A1 SolarStore'], ['sunsuppv.com', 'Sun Supply PV']
];

function retailerFor(url) { return retailers.find(([domain]) => url.includes(domain))?.[1] || 'Retailer'; }
function fromHtml(html) {
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of jsonLd) {
    try {
      const data = JSON.parse(match[1]);
      const item = Array.isArray(data) ? data[0] : data['@graph']?.[0] || data;
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      const price = Number(offer?.price);
      if (Number.isFinite(price) && price > 0) return { price, availability: offer.availability?.split('/').pop() || 'Unknown' };
    } catch (_) { /* Try the next structured-data block. */ }
  }
  const price = html.match(/(?:price|saleprice)["'\s:=]+\$?([0-9]+(?:\.[0-9]{2})?)/i)?.[1];
  return price ? { price: Number(price), availability: 'Unknown' } : null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user && !['admin', 'approver'].includes(user.role || user.app_role)) return Response.json({ error: 'Forbidden' }, { status: 403 });
    const { dryRun = false } = await req.json().catch(() => ({}));
    const products = await base44.asServiceRole.entities.Product.filter({ is_active: true });
    const pending = await base44.asServiceRole.entities.PriceReview.filter({ status: 'pending' });
    const findings = [];
    const addFinding = async (product, retailerPrice, availability) => {
      const existing = pending.find(review => review.product_id === product.id && review.availability === availability && Math.abs(review.retailer_price - retailerPrice) < 0.01);
      if (existing) return;
      const review = { product_id: product.id, product_name: product.name, catalog_price: product.unit_price, retailer_price: retailerPrice, retailer_name: retailerFor(product.product_link), source_url: product.product_link, availability, detected_date: new Date().toISOString(), status: 'pending' };
      if (!dryRun) await base44.asServiceRole.entities.PriceReview.create(review);
      findings.push(review);
    };
    for (const product of products.filter(item => item.product_link && item.unit_price > 0)) {
      try {
        const response = await fetch(product.product_link, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EnquotePriceMonitor/1.0)' }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) { await addFinding(product, product.unit_price, `Web access unavailable (${response.status})`); continue; }
        const current = fromHtml(await response.text());
        if (!current) { await addFinding(product, product.unit_price, 'Price unavailable'); continue; }
        if (current.availability === 'OutOfStock' || Math.abs(current.price - product.unit_price) >= 0.01) await addFinding(product, current.price, current.availability);
      } catch (_) { await addFinding(product, product.unit_price, 'Web access unavailable'); }
    }
    return Response.json({ scanned: products.length, discrepancies: findings.length, findings });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
});