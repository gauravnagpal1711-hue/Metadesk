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

legalRouter.get('/terms', (req, res) => {
  const name = process.env.PRIVACY_BUSINESS_NAME || 'Ads Desk';
  const email = process.env.PRIVACY_CONTACT_EMAIL || '';
  const updated = process.env.PRIVACY_LAST_UPDATED || new Date().toISOString().slice(0, 10);
  const contact = email ? ` <a href="mailto:${email}">${email}</a>` : ' the contact details on our website.';

  res.type('html').send(page({
    title: 'Terms of Service',
    body: `
<h1>Terms of Service</h1>
<p class="muted">Last updated: ${updated}</p>

<p>These terms govern use of ${name} ("we", "us", "the service") by businesses
that sign up for an account ("account holders"). By creating an account you
agree to these terms.</p>

<h2>What the service does</h2>
<p>${name} lets an account holder connect their own Meta (Facebook/Instagram)
advertising account, Facebook Page, and WhatsApp number, then create, launch,
and manage ad campaigns and view the leads those campaigns generate, from one
dashboard.</p>

<h2>Your account</h2>
<p>You are responsible for the accuracy of the information you provide, for
keeping your login credentials confidential, and for all activity that happens
under your account. You must have the right to advertise on behalf of the
business you connect, and the necessary admin/advertiser access on the Meta
assets (ad account, Page, WhatsApp number) you connect.</p>

<h2>Acceptable use</h2>
<p>You agree to use the service only for lawful advertising and customer
communication, and to comply with Meta's own Advertising Policies, Commerce
Policies, and WhatsApp Business Messaging Policy at all times — we do not
review your ad content or messages before they go out, and Meta may reject,
pause, or restrict your ads or WhatsApp number independently of anything we
do. You agree not to use the service to send unsolicited messages, collect
data unlawfully, or advertise anything illegal.</p>

<h2>Ad spend and billing</h2>
<p>All advertising costs are billed directly by Meta to the payment method on
your own connected ad account. We do not charge, hold, or process your ad
spend, and we are not responsible for Meta's billing, ad delivery, or account
enforcement decisions.</p>

<h2>AI-generated content</h2>
<p>Ad copy, images, and video the service generates for you using AI are
provided as a starting point — you are responsible for reviewing and approving
anything before it is used in a live campaign.</p>

<h2>Your data</h2>
<p>How we collect, use, and store data is described in our
<a href="/privacy">Privacy Policy</a>. You can disconnect your Meta account or
WhatsApp number, or ask us to delete your account data, at any time.</p>

<h2>Disclaimer and liability</h2>
<p>The service is provided "as is". We do not guarantee ad performance, lead
volume, or that Meta will approve or keep any campaign running. To the maximum
extent permitted by law, we are not liable for indirect, incidental, or
consequential damages arising from your use of the service, including ad
spend lost to Meta account or campaign restrictions.</p>

<h2>Termination</h2>
<p>You may stop using the service and disconnect your accounts at any time. We
may suspend or terminate an account that violates these terms or Meta's own
policies.</p>

<h2>Changes</h2>
<p>We may update these terms from time to time; continued use of the service
after a change means you accept the updated terms.</p>

<h2>Contact</h2>
<p>Questions about these terms:${contact}</p>
`
  }));
});
