import express from 'express';

/**
 * Public, no-auth legal pages. Meta needs a reachable Privacy Policy URL for
 * the app to leave Development Mode and for every Instant Form, so we host one
 * here instead of sending the user off to a third-party site.
 *
 * Override the business identity with env vars:
 *   PRIVACY_BUSINESS_NAME   (default "this business")
 *   PRIVACY_CONTACT_EMAIL   (default unset — a line is shown only when set)
 *   PRIVACY_LAST_UPDATED    (default: today, YYYY-MM-DD)
 */
export const legalRouter = express.Router();

function page({ title, body }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { max-width: 720px; margin: 40px auto; padding: 0 20px; font: 15px/1.65 -apple-system, Segoe UI, Roboto, sans-serif; color: #1c1c1e; }
  h1 { font-size: 24px; } h2 { font-size: 17px; margin-top: 28px; }
  a { color: #2b3af0; }
  .muted { color: #6b6b70; font-size: 13px; }
</style>
</head><body>${body}</body></html>`;
}

legalRouter.get('/privacy', (req, res) => {
  const name = process.env.PRIVACY_BUSINESS_NAME || 'this business';
  const email = process.env.PRIVACY_CONTACT_EMAIL || '';
  const updated = process.env.PRIVACY_LAST_UPDATED || new Date().toISOString().slice(0, 10);

  res.type('html').send(page({
    title: 'Privacy Policy',
    body: `
<h1>Privacy Policy</h1>
<p class="muted">Last updated: ${updated}</p>

<p>This policy explains how ${name} ("we", "us") handles the personal
information you provide when you respond to one of our advertisements — for
example by submitting a lead form or starting a WhatsApp conversation.</p>

<h2>Information we collect</h2>
<p>Contact details you choose to share, such as your name, phone number, email
address, city, and any answers you give to questions in a lead form or in your
messages to us.</p>

<h2>How we use it</h2>
<p>Only to respond to your enquiry: to contact you about our products and
services, arrange appointments, and follow up on your interest. We do not sell
your information.</p>

<h2>Sharing</h2>
<p>We use Meta Platforms, Inc. (Facebook, Instagram, WhatsApp) to run our
advertising and receive your enquiry, and tools we operate ourselves to manage
follow-up. We share your details with service providers only as needed to
respond to you, and where the law requires it.</p>

<h2>Retention</h2>
<p>We keep enquiry details for as long as needed to serve you and to meet our
legal and accounting obligations, then delete them.</p>

<h2>Your choices</h2>
<p>You can ask us to show you the information we hold about you, correct it, or
delete it. To opt out of further contact, reply “STOP” to any message or contact
us using the details below.</p>

<h2>Contact</h2>
<p>Questions about this policy or your information:${email ? ` <a href="mailto:${email}">${email}</a>` : ' contact us through the channel you used to reach us.'}</p>
`
  }));
});
