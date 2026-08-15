# Ads Desk

A single-user control room for Meta advertising: make the creative, run the campaigns, work the leads, and talk to them on WhatsApp — all in one app.

| Tab | What it does |
| --- | --- |
| **Create** | Fill in the brief and the app builds a proper image prompt for you — no API key needed. Copy it into ChatGPT, then upload the artwork back into your gallery. If you later add an OpenAI key, a Generate button appears and skips the round trip. |
| **Campaigns** | Live campaign table from your Meta ad account. Edit daily budgets inline, pause and resume — changes go straight to Meta. |
| **Leads** | Kanban funnel. Drag a lead between stages. Open any lead for its full WhatsApp conversation trail, remarks, form answers and history. |
| **Connect** | Pair WhatsApp — either by scanning a QR code (WhatsApp Web) or via the official Cloud API. |

Stack: Express + Postgres + React (Vite). One Railway service serves the API and the built frontend.

---

## Deploy on Railway

1. **Create the project.** Push this folder to a GitHub repo, then in Railway: *New Project → Deploy from GitHub repo*. Or use `railway up` from this directory.
2. **Add Postgres.** In the same project: *New → Database → Add PostgreSQL*.
3. **Set variables** (Settings → Variables). At minimum:

   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   APP_PASSWORD = <the password you'll type to sign in>
   JWT_SECRET   = <any long random string>
   ```

   Then add the Meta, AI and WhatsApp keys from `.env.example` as you get them. The app boots fine without them — each tab tells you what's missing.
4. **Generate a domain.** Settings → Networking → Generate Domain.
5. Open the domain, sign in with `APP_PASSWORD`. Tables are created automatically on first boot, along with six default funnel stages.

### If you want WhatsApp Web pairing to survive redeploys

Railway's filesystem is wiped on every deploy, so the paired session would be lost. Add a volume:

*Service → Settings → Volumes → New Volume*, mount path `/data`. Then set `WA_SESSION_DIR=/data/wa-session`.

---

## Getting the Meta credentials

You need a Meta app with a **system user token**, not a short-lived one.

1. Go to [business.facebook.com](https://business.facebook.com) → Business Settings → Users → System Users → Add.
2. Assign your ad account and Facebook page to that system user with full control.
3. Generate a token with scopes: `ads_management`, `ads_read`, `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `business_management`.
4. Copy it into `META_ACCESS_TOKEN`. Your ad account ID is in Ads Manager, formatted `act_123456789`. Your page ID is on the page's About tab.

Leads only sync if `META_PAGE_ID` is set, since lead forms belong to the page rather than the ad account.

## Getting the WhatsApp credentials

**Cloud API (recommended for anything ongoing):** In Meta for Developers, add the WhatsApp product to your app. Copy the phone number ID into `WA_PHONE_NUMBER_ID` and a permanent token into `WA_TOKEN`. Pick any string for `WA_VERIFY_TOKEN`. In WhatsApp → Configuration, set the callback URL to `https://your-app.up.railway.app/api/whatsapp/webhook`, paste the same verify token, and subscribe to the `messages` field.

**WhatsApp Web:** nothing to configure — open the Connect tab and scan the code. Note this is an unofficial route; keep the volume of outbound messages sane.

---

## Running locally

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, APP_PASSWORD, JWT_SECRET
npm run dev:server        # http://localhost:3000
npm run dev:client        # http://localhost:5173, proxies /api to :3000
```

You need a Postgres instance. The easiest option is to copy the `DATABASE_URL` from your Railway Postgres — click the database → Connect → Public Network URL.

---

## How the pieces connect

- A background job runs every `SYNC_INTERVAL_MINUTES` and pulls campaigns plus new lead-form submissions into Postgres. The Sync buttons in the UI trigger the same code on demand.
- Incoming WhatsApp messages — from either route — are matched to a lead by phone number. Unknown numbers create a new lead in your first funnel stage, so nothing gets lost.
- Phone numbers are normalised on the way in: 10 digits get `DEFAULT_COUNTRY_CODE` prepended, so a Meta lead and a WhatsApp chat resolve to the same person.
- Dragging a card writes the new stage and logs a history entry on that lead.

## Working without API keys

The Create tab is built to be useful on day one with zero API spend:

- The image prompt is assembled in your browser from the brief, offer, audience, look and placement. Nothing is called.
- **Copy prompt** puts it on your clipboard. Paste it into ChatGPT (your consumer subscription is fine), download the image, and upload it back under *Bring the artwork back*. It lands in the gallery tagged `manual`, with your headline and primary text attached.
- **Copy for Ads Manager** gives you the headline, primary text and button in one block, ready to paste when you build the ad.

Add `OPENAI_API_KEY` later and a **Generate here instead** button appears, removing the round trip. Add `ANTHROPIC_API_KEY` and a **Write the ad copy for me** button appears. Neither is required.

Note that a ChatGPT Plus or Go subscription does **not** include API access — the API is billed separately at platform.openai.com.

## Where to extend it next

- **Video creatives.** The `creatives` table already has a `kind` and `video_url` column. Wire a video model into `server/services/ai.js` and post to `/api/creatives/video`.
- **Publishing to Meta.** Right now creatives are downloaded and uploaded by hand. The next step is `POST /act_<id>/adimages` then `/ads` to push an approved creative live.
- **Automations.** Add a rule table and fire a WhatsApp template the moment a lead lands in a given stage.

## Layout

```
server/
  index.js              Express app, background sync, serves the built client
  db.js schema.sql      Postgres pool, tables, default stages
  auth.js               password login, JWT cookie
  routes/               creatives, campaigns, leads, whatsapp
  services/             meta.js, ai.js, whatsappCloud.js, whatsappWeb.js
client/src/
  App.jsx               rail navigation, auth gate
  tabs/                 Creative, Campaigns, Leads, Connect
  components/           LeadDrawer, Login
  styles.css            all styling
```
