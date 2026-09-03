const http = require('http');
const fs = require('fs');
const PORT = 3001;
const SECRET = process.env.BASE44_WEBHOOK_SECRET || 'afQ2E1gxnPZzN8ARf7S4CF9TErjWU4dt4iXECvoSUi0';

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/base44/webhook') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    return;
  }

  const sig = req.headers['x-base44-signature'] || req.headers['x-webhook-signature'] || '';
  const chunks = [];

  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try { body = JSON.parse(raw) || {}; } catch { body = { raw }; }

    if (SECRET && SECRET !== 'replace-me' && sig !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }

    const line = JSON.stringify({ receivedAt: new Date().toISOString(), body }) + '\n';
    fs.appendFileSync('webhook-events.jsonl', line, 'utf8');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, received: true, count: 1 }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Webhook receiver listening on http://localhost:' + PORT + '/api/base44/webhook');
});
