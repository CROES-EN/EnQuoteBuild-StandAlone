import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const retailers = [
  { name: 'The Home Depot', url: 'https://www.homedepot.com/', domains: ['homedepot.com'] },
  { name: 'CED GreenTech Renewables', url: 'https://www.greentechrenewables.com/', domains: ['greentechrenewables.com'] },
  { name: 'Enphase Store', url: 'https://enphase.com/store', domains: ['enphase.com'] },
  { name: 'Standard Electric Supply', url: 'https://www.standardelectricsupply.com/', domains: ['standardelectricsupply.com'] },
  { name: 'Soligent', url: 'https://www.soligent.net/', domains: ['soligent.net'] },
  { name: 'BayWa r.e. Solar Distribution', url: 'https://solar-store-us.baywa-re.com/', domains: ['baywa-re.com'] },
  { name: 'Solar Electric Supply', url: 'https://www.solarelectricsupply.com/', domains: ['solarelectricsupply.com'] },
  { name: 'A1 SolarStore', url: 'https://a1solarstore.com/', domains: ['a1solarstore.com'] },
  { name: 'Sun Supply PV', url: 'https://sunsuppv.com/', domains: ['sunsuppv.com'] }
];

const fields = ['id', 'name', 'description', 'product_link', 'category', 'type', 'unit_price', 'unit', 'is_active'];
const urlPattern = /https?:\/\/[^\s"'<>]+/i;

function value(row, key) {
  const normalizedKey = key.replaceAll('_', '').toLowerCase();
  const matchingKey = Object.keys(row).find(column => column.replace(/[^a-z0-9]/gi, '').toLowerCase() === normalizedKey);
  return row[key] ?? row[key.replaceAll('_', ' ')] ?? row[key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())] ?? (matchingKey ? row[matchingKey] : '');
}

function normalize(row, currentProducts) {
  const name = String(value(row, 'name')).trim();
  const suppliedId = String(value(row, 'id')).trim();
  const current = currentProducts.find(product => product.id === suppliedId)
    || currentProducts.find(product => product.name?.trim().toLowerCase() === name.toLowerCase());
  const text = fields.map(field => String(value(row, field))).join(' ');
  const foundUrl = text.match(urlPattern)?.[0] || current?.product_link || current?.description?.match(urlPattern)?.[0] || '';
  const match = retailers.find(retailer => retailer.domains.some(domain => foundUrl.toLowerCase().includes(domain)));
  return {
    row_number: Number(value(row, 'row_number')) || 0,
    id: current?.id || suppliedId || '',
    name,
    description: String(value(row, 'description')).trim(),
    type: String(value(row, 'type')).trim().toLowerCase() || current?.type || 'product',
    category: String(value(row, 'category')).trim(),
    unit_price: Number(value(row, 'unit_price')) || 0,
    unit: String(value(row, 'unit')).trim(),
    is_active: String(value(row, 'is_active')).toLowerCase() !== 'no' && String(value(row, 'is_active')).toLowerCase() !== 'false',
    product_link: foundUrl,
    action: current ? 'update' : 'create',
    retailer: match ? { name: match.name, url: match.url } : null,
    warnings: [
      !name && 'Missing item name',
      !value(row, 'unit_price') && 'Missing unit price',
      !foundUrl && 'No retailer link found in Product Link, Description, or existing catalog data'
    ].filter(Boolean)
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { rows, currentProducts = [] } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) return Response.json({ error: 'No import rows provided' }, { status: 400 });
    const validatedRows = rows.slice(0, 500).map(row => normalize(row, currentProducts));
    return Response.json({
      rows: validatedRows,
      retailer_sources: retailers.map(({ name, url }) => ({ name, url })),
      summary: {
        creates: validatedRows.filter(row => row.action === 'create' && row.name).length,
        updates: validatedRows.filter(row => row.action === 'update' && row.name).length,
        linked: validatedRows.filter(row => row.retailer).length,
        needs_review: validatedRows.filter(row => row.warnings.length > 0).length
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});