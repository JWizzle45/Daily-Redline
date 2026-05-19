# 🤿 The Daily Dive Newsletter

An automated daily scuba and ocean newsletter powered by Claude AI, delivered every morning via SendGrid.

## How It Works

The system runs a **4-stage Claude pipeline** on a daily schedule:

| Stage | What happens |
|-------|-------------|
| **Stage 1** | Fetch RSS feeds → deduplicate → filter → categorize + score each article with Claude |
| **Stage 2** | Claude selects the featured hero story, highlights box, section lineup, and quick hits |
| **Stage 3** | Claude writes all newsletter copy: intro, headlines, summaries, CTA text, Dive Fact |
| **Stage 4** | Pure JavaScript assembles the final HTML email (no extra Claude call — fast and deterministic) |

The finished HTML is sent via SendGrid.

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
npm install
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in your four values (see below).

### 3. Run a dry run (no email sent)

```bash
npm run dry-run
# or
DRY_RUN=true node newsletter.js
```

### 4. Send a real newsletter

```bash
node newsletter.js
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Claude API key |
| `SENDGRID_API_KEY` | Yes | Your SendGrid API key |
| `FROM_EMAIL` | Yes | Verified sender address (must match SendGrid verified sender) |
| `TO_EMAIL` | Yes | Recipient email address |
| `DRY_RUN` | No | Set `true` to skip Claude + SendGrid (default: `false`) |
| `MAX_ARTICLES` | No | Max articles to process per run (default: `20`) |

---

## Getting API Keys

### Anthropic (Claude)

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign in or create an account
3. Navigate to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-`)

### SendGrid

1. Go to [app.sendgrid.com](https://app.sendgrid.com/)
2. Sign in or create a free account
3. Go to **Settings → API Keys → Create API Key**
4. Choose **Restricted Access** → enable **Mail Send → Full Access**
5. Copy the key (starts with `SG.`)
6. Also verify your sender: **Settings → Sender Authentication**
   - Either verify a single email address OR authenticate your full domain

---

## Setting GitHub Secrets (for automatic daily delivery)

1. In your GitHub repository, go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret** and add each of:
   - `ANTHROPIC_API_KEY`
   - `SENDGRID_API_KEY`
   - `FROM_EMAIL`
   - `TO_EMAIL`

The GitHub Actions workflow (`.github/workflows/daily-dive.yml`) reads these automatically.

---

## File Structure

```
├── newsletter.js                    # Main script — all pipeline logic
├── package.json
├── .env.example                     # Template — copy to .env
├── .github/
│   └── workflows/
│       └── daily-dive.yml           # GitHub Actions schedule
└── README.md
```

---

## Customizing RSS Feeds

Open `newsletter.js` and find the `RSS_FEEDS` array near the top:

```js
const RSS_FEEDS = [
  "https://divernet.com/feed/",
  "https://www.deeperblue.com/feed/",
  "https://blog.padi.com/feed/",
  "https://www.scubadiving.com/rss.xml",
  // Add more feeds:
  // "https://alertdiver.eu/en/feed/",
  // "https://oceana.org/feed/",
];
```

Add any public RSS feed that covers scuba, ocean, or marine topics.

---

## Customizing the Design

All colors are defined in the `D` (design tokens) object near the top of `newsletter.js`:

```js
const D = {
  navy      : "#0a2540",
  teal      : "#0a7ea4",
  tealDark  : "#0e4d6b",
  tealLight : "#e8f4f8",
  bg        : "#f0f7ff",
  cardBg    : "#ffffff",
  text      : "#1a2e40",
  muted     : "#6b7280",
  factBg    : "#fff8e6",
  factBorder: "#f5c842",
};
```

Change these hex values to retheme the entire newsletter.

**Fallback images** (used when articles have no relevant image) are in the `FALLBACK_IMAGES` object.
Replace any Unsplash URL with your own.

---

## Schedule

The newsletter runs daily at **5:30 AM PDT** (12:30 UTC):

```yaml
- cron: '30 12 * * *'
```

> **Note on daylight saving:** California observes PDT (UTC-7) from March–November and PST (UTC-8) November–March.
> The cron above is accurate for PDT. In winter it will fire at 4:30 AM PST.
> Adjust to `'30 13 * * *'` in winter if you need strict 5:30 AM PST delivery.

### Manual trigger

In GitHub: **Actions → The Daily Dive Newsletter → Run workflow**

You can set the optional `dry_run` input to `true` to test without sending.

---

## Testing Before Sending

```bash
# 1. Test the full pipeline — sends a real email
node newsletter.js

# 2. Test without sending (checks RSS + exits)
DRY_RUN=true node newsletter.js

# 3. See full error stack traces
DEBUG=true node newsletter.js

# 4. Limit article count for faster testing
MAX_ARTICLES=5 node newsletter.js
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing environment variables` | Check your `.env` file or GitHub Secrets |
| `Not enough articles` | Check if RSS feeds are reachable; verify URLs |
| Email not received | Check SendGrid Activity Feed for delivery status |
| Wrong send time | Adjust the cron UTC time (see Schedule section) |
| JSON parse error in logs | Usually recovers automatically with fallback copy |
| `403 Forbidden` from SendGrid | Verify your sender domain/email in SendGrid |

---

## Architecture Notes

### Why 3 Claude calls instead of 1?

One giant call produces worse output because Claude tries to editorialize, categorize, write, and design at the same time. Splitting into stages:

1. **Stage 1** — gives Claude only the categorization task. Output is structured JSON.
2. **Stage 2** — gives Claude the scored data and asks only "what goes where." Better decisions.
3. **Stage 3** — gives Claude only the writing task, with full context about which stories matter. Better copy.
4. **Stage 4** — pure JavaScript HTML generation. Deterministic, fast, no hallucination risk.

### Image scoring

Each article is scored against diving/ocean keyword lists (high/medium/low weight).
Articles scoring ≥ 3 on the relevance scale use their own RSS image.
Articles below that threshold get a category-appropriate Unsplash fallback.
Images are tracked in a `Set` to prevent duplicates across one edition.

---

## License

MIT
