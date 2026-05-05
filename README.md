# 🚗 The Daily Redline - Automotive Newsletter System

A production-ready automated newsletter system powered by Claude AI that curates the best automotive news from top sources and delivers a beautifully formatted daily email to your inbox.

**Features:**
- 📰 Aggregates content from 8 automotive sources (Motor1, Car and Driver, Top Gear, Jalopnik, etc.)
- 🧠 Uses Claude AI for intelligent article scoring and curation
- ✍️ Claude writes authentic, punchy copy (zero corporate BS)
- 📧 Beautiful, mobile-responsive HTML emails
- 🤖 Fully automated via GitHub Actions (5:30 AM Pacific daily)
- 🔧 Copy-paste ready, production-safe code
- 🚫 Banned phrase detection prevents lazy AI writing

---

## 🎯 Quick Start (5 minutes)

### 1. Clone and Setup

```bash
git clone <your-repo-url>
cd the-daily-redline
npm install
cp .env.example .env
```

### 2. Get API Keys

#### Anthropic (Claude API)
1. Visit [console.anthropic.com](https://console.anthropic.com/)
2. Create an account or sign in
3. Go to **API Keys** in the left sidebar
4. Click **Create Key** and copy it
5. Paste into `.env` as `ANTHROPIC_API_KEY`

#### SendGrid (Email Delivery)
1. Visit [sendgrid.com](https://sendgrid.com/)
2. Create a free account
3. Go to **Settings → API Keys**
4. Click **Create API Key**
5. Paste into `.env` as `SENDGRID_API_KEY`
6. **Important:** Verify your sender email in SendGrid (Settings → Sender Authentication)

### 3. Configure Email

Edit `.env`:
```env
FROM_EMAIL=newsletter@yourdomain.com    # Must be verified in SendGrid
TO_EMAIL=you@example.com                # Your email address
ANTHROPIC_API_KEY=sk-ant-xxx...         # Your Claude API key
SENDGRID_API_KEY=SG.xxx...              # Your SendGrid key
DRY_RUN=true                            # Test first
```

### 4. Test Locally

```bash
# DRY_RUN=true generates HTML but doesn't send
npm run dev
```

This creates `/tmp/daily-redline-preview.html` — open it in your browser to preview the email.

### 5. Send Your First Newsletter

Once DRY_RUN works:

```bash
# Update .env
DRY_RUN=false

# Run the newsletter
npm start
```

---

## 🚀 Deploy to GitHub Actions

### Step 1: Push to GitHub

```bash
git add .
git commit -m "Initial commit: The Daily Redline"
git push origin main
```

### 2: Add Secrets to GitHub

Go to your GitHub repo **Settings → Secrets and variables → Actions** and add:

| Secret Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `SENDGRID_API_KEY` | Your SendGrid API key |
| `FROM_EMAIL` | newsletter@yourdomain.com |
| `TO_EMAIL` | you@example.com |

### 3: Move Workflow File

The workflow file goes in a specific location:

```bash
mkdir -p .github/workflows
mv daily-redline.yml .github/workflows/daily-redline.yml
git add .github/workflows/daily-redline.yml
git commit -m "Add GitHub Actions workflow"
git push origin main
```

### 4: Verify Workflow

1. Go to **Actions** tab in GitHub
2. You should see "The Daily Redline Newsletter" workflow
3. Click **Run workflow** to test manually
4. It will run at **5:30 AM Pacific** every day

---

## 📰 Customize RSS Feeds

Edit `newsletter.js` and modify the `RSS_FEEDS` array:

```javascript
const RSS_FEEDS = [
  { name: "Motor1", url: "https://www.motor1.com/feed/rss/" },
  { name: "Your Feed", url: "https://example.com/feed.xml" },
  // Add more...
];
```

**Popular automotive RSS feeds:**
- Motor1: `https://www.motor1.com/feed/rss/`
- Car and Driver: `https://www.caranddriver.com/feed/rss/`
- Top Gear: `https://www.topgear.com/feed`
- Jalopnik: `https://jalopnik.com/feed`
- InsideEVs: `https://insideevs.com/feed/`
- Autoblog: `https://www.autoblog.com/feed/`
- Road & Track: `https://www.roadandtrack.com/feed.rss`

---

## 🧠 How the 3-Stage Claude System Works

### Stage 1: Fetch & Score
- Fetches latest articles from RSS feeds
- Deduplicates by title
- **Claude API call #1**: Scores each article by:
  - Relevance to car enthusiasts (1-10)
  - Interest/engagement level (1-10)
  - Category assignment (New Releases, EV & Tech, Motorsports, etc.)
  - Featured story candidate evaluation

### Stage 2: Select Lineup
- Picks the #1 story as featured
- Selects top 5 highlights
- Groups remaining articles by category
- Picks 3 random quick hits

### Stage 3: Write Copy
- **Claude API call #2**: Generates all copy for:
  - Newsletter intro
  - Featured story headline + summary
  - Highlight headlines + summaries
  - Category section headlines
  - Quick hit one-liners
  - "Car Insight of the Day"

**Tone & Style:**
- Smart, punchy, zero corporate fluff
- 2-3 sentence summaries max
- Focus on real-world impact & ownership implications
- All 11 banned phrases filtered out

### Stage 4: HTML Generation
- Pure JavaScript (no Claude)
- Generates table-based, mobile-responsive HTML
- Gmail-compatible inline CSS
- Color-coded categories
- One-click links to source articles

---

## 🔧 Advanced Configuration

### Change Daily Time

Edit `.github/workflows/daily-redline.yml`:

```yaml
schedule:
  # Time is in UTC. To run at different times:
  # 5:30 AM Pacific = "30 13 * * *"
  # 8:00 AM Eastern = "00 13 * * *"
  # 12:00 PM UTC = "00 12 * * *"
  - cron: "30 13 * * *"
```

[Use crontab.guru](https://crontab.guru/) to convert times.

### Adjust Article Count

In `newsletter.js`:

```javascript
// Stage 1: How many articles to fetch per feed
.slice(0, 10)  // Change 10 to fetch more/fewer

// Stage 2: How many highlights to include
.slice(0, 5)   // Change 5 to have more/fewer highlights
```

### Customize Email Categories

In `newsletter.js`, modify `CATEGORY_KEYWORDS`:

```javascript
const CATEGORY_KEYWORDS = {
  "Your Category": [
    "keyword1",
    "keyword2",
    "keyword3",
  ],
};
```

### Change Email Design Colors

In `generateHTML()`:

```javascript
const categoryMap = {
  "New Releases": "#FF6B35",    // Orange
  "Electric & Tech": "#00D9FF", // Cyan
  // Change hex colors to your brand
};
```

---

## ⚠️ Troubleshooting

### "Missing environment variables" error
- Copy `.env.example` to `.env`
- Fill in all 4 required keys
- Check for typos in variable names

### "Failed to fetch {Feed Name}"
- RSS feed might be temporarily down
- System gracefully skips failed feeds
- Check if URL is correct in `RSS_FEEDS`

### Newsletter sent but looks broken in Gmail
- Some email clients strip CSS
- Table-based layout is Gmail-compatible
- Try different email client to verify

### Claude API returns low-quality scores
- Add more context in Stage 1 prompt
- Increase `max_tokens` value
- Check ANTHROPIC_API_KEY is correct

### SendGrid says "Unauthorized"
- Verify API key is correct
- Ensure sender email is verified in SendGrid dashboard
- Check key has "Mail Send" permissions

### Workflow doesn't run on schedule
- Workflows require at least one push to main branch after adding secrets
- GitHub Actions require scheduled workflows to be on main/master branch
- Check **Actions** tab to see workflow status

---

## 📊 Email Preview

Here's what subscribers see:

```
┌─────────────────────────────────────┐
│     🏁 THE DAILY REDLINE            │
│     Thursday, May 23, 2024          │
├─────────────────────────────────────┤
│                                     │
│  Today's the kind of day where...   │
│                                     │
├─────────────────────────────────────┤
│                                     │
│  ⭐ FEATURED STORY                  │
│  New Porsche 911 Hybrid Announced   │
│  Porsche is adding hybrid power...  │
│  [Read Full Story →]                │
│                                     │
├─────────────────────────────────────┤
│                                     │
│  TODAY'S HIGHLIGHTS                 │
│                                     │
│  ① Tesla Recall Impacts 2.2M Units  │
│  ② BMW M Performance Lineup Expands  │
│  ③ F1 Spring Rumors Heat Up         │
│  ...and 2 more                      │
│                                     │
├─────────────────────────────────────┤
│  ELECTRIC & TECH | NEW RELEASES     │
│  MOTORSPORTS | BUILDS & MODS        │
│                                     │
├─────────────────────────────────────┤
│  ⚡ QUICK HITS                      │
│  • Formula 1 testing update...      │
│  • Toyota hybrid sales surge...     │
│  • Recall notice: Check VINs...     │
│                                     │
├─────────────────────────────────────┤
│  🧠 CAR INSIGHT OF THE DAY          │
│  "Modern supercars are slower...    │
└─────────────────────────────────────┘
```

---

## 🚫 Banned Phrases (Auto-Filtered)

The system explicitly avoids corporate AI language:

- ❌ "groundbreaking"
- ❌ "cutting-edge"
- ❌ "innovative solution"
- ❌ "pushes boundaries"
- ❌ "in today's fast-paced world"
- ❌ "game-changing"
- ❌ "revolutionary"

If Claude tries to use these, prompts explicitly call them out.

---

## 📁 File Structure

```
the-daily-redline/
├── newsletter.js              # Main script (4 stages)
├── package.json               # Dependencies
├── .env.example               # Environment template
├── .env                       # Your API keys (git ignored)
├── README.md                  # This file
└── .github/
    └── workflows/
        └── daily-redline.yml  # GitHub Actions workflow
```

---

## 🔐 Security Best Practices

1. **Never commit `.env` file** — it contains API keys
2. **Use GitHub Secrets** — not environment variables in workflow
3. **Rotate API keys regularly** — especially SendGrid
4. **Monitor API usage** — watch Anthropic and SendGrid dashboards
5. **Set spending limits** — both services offer rate limiting

---

## 💡 Tips & Tricks

**Test before deploying:**
```bash
DRY_RUN=true npm start
```

**Get faster feedback:**
Add fewer RSS feeds during development — reduces Claude API calls.

**Debug copy generation:**
Check `/tmp/daily-redline-preview.html` for HTML output.

**Monitor the workflow:**
GitHub Actions tab shows execution logs for troubleshooting.

**Customize tone:**
Edit the copy generation prompt in Stage 3 to match your voice.

---

## 📞 Support

- **Claude API Docs**: [docs.anthropic.com](https://docs.anthropic.com)
- **SendGrid Docs**: [sendgrid.com/docs](https://sendgrid.com/docs)
- **GitHub Actions Docs**: [docs.github.com/actions](https://docs.github.com/actions)

---

## 📜 License

MIT — Feel free to fork, modify, and deploy!

---

## 🚗 What's Next?

Ideas for enhancement:
- [ ] Add image integration for each story
- [ ] Implement subscriber preferences (categories to receive)
- [ ] Add A/B testing for subject lines
- [ ] Integrate analytics (Mailchimp, Substack)
- [ ] Create web archive of past issues
- [ ] Add social sharing buttons
- [ ] Build subscriber dashboard
- [ ] Implement content caching to reduce API calls

---

**Happy motoring! 🏁**

Built with ❤️ using Claude AI, Node.js, and SendGrid.
