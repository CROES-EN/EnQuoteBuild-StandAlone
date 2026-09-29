import { createClientFromRequest } from "@base44/sdk";
import { secrets } from "base44:runtime";

const ENTITY_NAMES = [
  'Quote', 'QuoteActivity', 'Product', 'User', 'PriceReview', 'QuoteReview',
  'QuoteAlert', 'StatusAlertDismissal', 'Invitation', 'MaterialOrder', 'PVPanelRMA',
  'PVManufacturer', 'FollowUpConfig', 'FollowUpLog', 'EmailDistribution',
  'QuoteDeletionRequest', 'PDFTemplate', 'FST', 'SiteFlag', 'SupportInteraction',
  'SVCancelTracker'
];

function hex(bytes) {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

export default async function(req) {
  const WEBHOOK_URL = secrets.get("https://enquote-sync.enphase-enquote.com/api/base44/webhook");

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    const isAdmin = user?.role === 'admin' || user?.app_role === 'admin' || user?.additional_roles?.includes('admin');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 });

    const input = await req.json().catch(() => ({}));
    const fetchAll = async (entityName) => {
      const records = [];
      const pageSize = 200;
      let skip = 0;
      while (true) {
        const page = await base44.asServiceRole.entities[entityName].list('-updated_date', pageSize, skip);
        records.push(...page);
        if (page.length < pageSize) return records;
        skip += pageSize;
      }
    };

    const exports = await Promise.all(ENTITY_NAMES.map(async (entityName) => [entityName, await fetchAll(entityName)]));
    const entities = Object.fromEntries(exports);
    const sentAt = new Date().toISOString();
    const triggerEvent = input?.event || {};
    const payload = {
      schema_version: 'enquote-local-sync-v1',
      delivery_id: crypto.randomUUID(),
      sent_at: sentAt,
      mode: 'snapshot',
      trigger: {
        type: triggerEvent.type ? 'entity_change' : 'scheduled',
        entity_name: triggerEvent.entity_name || null,
        operation: triggerEvent.type || null,
        record_id: triggerEvent.entity_id || null
      },
      snapshot: {
        counts: Object.fromEntries(exports.map(([entityName, records]) => [entityName, records.length])),
        entities
      }
    };
    const encryptionKeyBase64 = secrets.get('ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY');
    const encryptionKeyBytes = Uint8Array.from(atob(encryptionKeyBase64), (character) => character.charCodeAt(0));
    if (encryptionKeyBytes.length !== 32) {
      return Response.json({ error: 'Local sync encryption key must be a base64-encoded 32-byte key' }, { status: 500 });
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptionKey = await crypto.subtle.importKey('raw', encryptionKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, new TextEncoder().encode(JSON.stringify(payload)));
    const encryptedPayload = {
      schema_version: 'enquote-local-sync-v2',
      delivery_id: payload.delivery_id,
      sent_at: sentAt,
      mode: 'snapshot',
      encryption: {
        algorithm: 'AES-256-GCM',
        encoding: 'base64',
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext))
      }
    };
    const rawBody = JSON.stringify(encryptedPayload);
    const secret = secrets.get('ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET');
    const signingKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = hex(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(rawBody)));
    const relayResponse = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ENQuote-Signature': `sha256=${signature}`,
        'X-ENQuote-Timestamp': sentAt
      },
      body: rawBody
    });
    const responseText = await relayResponse.text();
    if (!relayResponse.ok) {
      return Response.json({ error: 'Local relay rejected snapshot', status: relayResponse.status, response: responseText }, { status: 502 });
    }
    const snapshotBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    const transmittedBytes = new TextEncoder().encode(rawBody).byteLength;
    return Response.json({
      delivered: true,
      delivery_id: payload.delivery_id,
      sent_at: sentAt,
      status: relayResponse.status,
      counts: payload.snapshot.counts,
      size: {
        snapshot_bytes: snapshotBytes,
        snapshot_kb: Number((snapshotBytes / 1024).toFixed(2)),
        snapshot_mb: Number((snapshotBytes / (1024 * 1024)).toFixed(2)),
        transmitted_encrypted_bytes: transmittedBytes,
        transmitted_encrypted_kb: Number((transmittedBytes / 1024).toFixed(2)),
        transmitted_encrypted_mb: Number((transmittedBytes / (1024 * 1024)).toFixed(2))
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
