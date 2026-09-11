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
  const name = process.env.PRIVACY_BUSINESS_NAME || 'Ads Desk';
  const email = process.env.PRIVACY_CONTACT_EMAIL || '';
  const updated = process.env.PRIVACY_LAST_UPDATED || new Date().toISOString().slice(0, 10);
  const contact = email ? ` <a href="mailto:${email}">${email}</a>` : ' the contact details on our website.';

  res.type('html').send(page({
    title: 'Privacy Policy',
    body: `
<h1>Privacy Policy</h1>
<p class="muted">Last updated: ${updated}</p>

<p>${name} ("we", "us") is an advertising management platform. Businesses
("account holders") sign up to connect their own Meta (Facebook/Instagram)
advertising account, Facebook Page, and WhatsApp number, so they can create
and manage ad campaigns and respond to the leads those ads generate. This
policy covers two audiences: <strong>account holders</strong> who use Ads Desk,
and <strong>end customers</strong> who respond to an account holder's ads.</p>

<h2>Information we collect from account holders</h2>
<ul>
<li><strong>Account info</strong> — the username and password used to sign up.</li>
<li><strong>Meta Platform Data</strong> — when an account holder connects Facebook, we request
access (via Facebook Login) to their profile name, the ad accounts and Pages
they manage, and campaign/ad-set/ad data for those assets. We use this solely
to create, read, and manage advertising campaigns on the account holder's
behalf, and never for any other purpose. Access tokens are stored encrypted at
rest on our servers and are never exposed to the browser or to other account
holders.</li>
<li><strong>WhatsApp data</strong> — if an account holder connects a WhatsApp number (via
Meta's Cloud API or by pairing their own device), we process the messages sent
and received through that number so they can be shown in the account holder's
lead inbox and so automated replies can be suggested.</li>
<li><strong>Creative content</strong> — images, video, and text an account holder uploads or
generates for their ads.</li>
</ul>

<h2>Information we collect from end customers</h2>
<p>When someone responds to an account holder's ad — for example by starting a
WhatsApp conversation or submitting a lead form — we collect the contact
details they share (such as name, phone number, and any message content) on
behalf of, and for the sole use of, the account holder whose ad they responded
to. We do not use this information for our own marketing, and one account
holder never has access to another's end-customer data.</p>

<h2>How we use information</h2>
<p>To operate the service an account holder signed up for: creating and
managing their ad campaigns via the Meta Marketing API, receiving and
displaying their leads, and (optionally) suggesting ad copy or reply text using
AI. We do not sell personal information to anyone.</p>

<h2>Sharing</h2>
<p>We share data with Meta Platforms, Inc. (to run advertising and deliver
WhatsApp messages on the account holder's behalf) and with AI providers we use
to generate ad creative and copy suggestions (Anthropic, OpenAI, and/or
Google), strictly to provide that functionality. We do not share data with any
other third party except where required by law.</p>

<h2>Retention</h2>
<p>We retain account and lead data for as long as the account holder's account
is active, plus a reasonable period afterward for legal and accounting
purposes, then delete it. An account holder can disconnect their Meta account
at any time, which immediately revokes and deletes the stored access token.</p>

<h2>Your choices</h2>
<p>Account holders can request a copy of, correct, or delete the data we hold
for their account by contacting us. End customers who want their data removed
should contact the business whose ad they responded to, or contact us directly
and we will forward the request.</p>

<h2>Children</h2>
<p>Ads Desk is not directed at children and we do not knowingly collect data
from anyone under 18.</p>

<h2>Contact</h2>
<p>Questions about this policy or your information:${contact}</p>
`
  }));
});
