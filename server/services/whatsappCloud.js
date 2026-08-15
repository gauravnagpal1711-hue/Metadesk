/**
 * Official WhatsApp Cloud API. Best for reliable, always-on messaging.
 * Needs WA_PHONE_NUMBER_ID, WA_TOKEN and WA_VERIFY_TOKEN.
 */
const VERSION = process.env.META_API_VERSION || 'v21.0';

export function cloudConfigured() {
  return Boolean(process.env.WA_PHONE_NUMBER_ID && process.env.WA_TOKEN);
}

export async function sendText(to, body) {
  if (!cloudConfigured()) throw new Error('WhatsApp Cloud API is not connected.');
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body }
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || 'WhatsApp send failed.');
  return { id: json.messages?.[0]?.id };
}

/** Flatten a webhook payload into [{ from, name, body, wa_message_id, ts }]. */
export function parseWebhook(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from);
        out.push({
          from: msg.from,
          name: contact?.profile?.name || null,
          body: msg.text?.body || msg.button?.text || `[${msg.type}]`,
          wa_message_id: msg.id,
          ts: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date()
        });
      }
    }
  }
  return out;
}
