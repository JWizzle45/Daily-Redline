# 🚀 The Daily Redline - Deployment Checklist

Use this checklist to ensure everything is configured correctly before your first production send.

---

## ✅ Pre-Deployment (Local Setup)

- [ ] **Clone repository**
  ```bash
  git clone <your-repo>
  cd the-daily-redline
  ```

- [ ] **Install Node.js (v18+)**
  ```bash
  node --version  # Should be v18.0.0 or higher
  ```

- [ ] **Install dependencies**
  ```bash
  npm install
  ```

- [ ] **Copy environment template**
  ```bash
  cp .env.example .env
  ```

- [ ] **.env file in .gitignore**
  Check that `.env` is listed in `.gitignore` (never commit API keys!)

---

## 🔑 API Keys Setup

### Anthropic Claude API

- [ ] **Visit** [console.anthropic.com](https://console.anthropic.com/)
- [ ] **Sign up or sign in**
- [ ] **Navigate to** API Keys (left sidebar)
- [ ] **Click** "Create Key"
- [ ] **Copy the key** starting with `sk-ant-`
- [ ] **Paste into .env:**
  ```env
  ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
  ```
- [ ] **Save .env file**
- [ ] **Verify key works** (run test below)

### SendGrid Email API

- [ ] **Visit** [sendgrid.com](https://sendgrid.com/)
- [ ] **Create free account** (no credit card required)
- [ ] **Verify your email address**
- [ ] **Go to Settings → API Keys**
- [ ] **Click "Create API Key"**
- [ ] **Name it** "The Daily Redline"
- [ ] **Copy the key** starting with `SG.`
- [ ] **Paste into .env:**
  ```env
  SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
  ```
- [ ] **Verify sender email in SendGrid:**
  - Go to Settings → Sender Authentication
  - Click "Verify Single Sender"
  - Add your FROM_EMAIL address
  - Click verification link in email (check spam folder)

---

## 📧 Email Configuration

- [ ] **Set FROM_EMAIL in .env**
  - Must be verified in SendGrid (see above)
  - Example: `newsletter@yourdomain.com` or `your-email@gmail.com`

- [ ] **Set TO_EMAIL in .env**
  - Where the newsletter will be sent
  - Example: `you@example.com`

- [ ] **Update .env with real values:**
  ```env
  FROM_EMAIL=your-verified-email@example.com
  TO_EMAIL=recipient@example.com
  ```

---

## 🧪 Local Testing

- [ ] **Ensure DRY_RUN is set to true in .env:**
  ```env
  DRY_RUN=true
  ```

- [ ] **Run the newsletter locally:**
  ```bash
  npm run dev
  ```
  Or:
  ```bash
  npm start
  ```

- [ ] **Check for errors:**
  - Should see logs like `[...] 🚀: Starting The Daily Redline...`
  - Should fetch from 8 RSS feeds
  - Should call Claude API twice (Stage 1 & 3)
  - Should generate HTML

- [ ] **Verify HTML output:**
  ```bash
  open /tmp/daily-redline-preview.html  # macOS
  # OR on Linux:
  cat /tmp/daily-redline-preview.html
  ```
  Check that:
  - Header shows "THE DAILY REDLINE"
  - Featured story is present
  - Highlights section populated
  - Quick hits included
  - Email looks mobile-friendly

- [ ] **Check for Claude cost estimate:**
  - Stage 1 (scoring): ~1,000-2,000 tokens
  - Stage 3 (copy generation): ~1,500-2,500 tokens
  - Total: ~3,000-5,000 tokens per run
  - Cost: ~$0.01-0.02 per newsletter (Claude 3.5 Sonnet pricing)

---

## 🚀 Production Deployment

- [ ] **Change DRY_RUN to false in .env:**
  ```env
  DRY_RUN=false
  ```

- [ ] **Run ONE MORE test to confirm email sends:**
  ```bash
  npm start
  ```
  Check that:
  - Logs show "Newsletter sent to {email}"
  - Check email inbox (may be in spam folder initially)
  - Click the "Read Full Story" link to verify URLs work

- [ ] **If email arrived:** Congratulations! 🎉
  Set up GitHub Actions for daily automation.

- [ ] **If email didn't arrive:**
  - Check spam folder
  - Verify sender email in SendGrid dashboard
  - Run again with `DRY_RUN=true` to check HTML
  - Check SendGrid activity log for bounce/reject reasons

---

## 🤖 GitHub Actions Setup

- [ ] **Commit all files:**
  ```bash
  git add .
  git commit -m "Initial commit: The Daily Redline"
  git push origin main
  ```

- [ ] **Create .github/workflows directory:**
  ```bash
  mkdir -p .github/workflows
  ```

- [ ] **Copy workflow file:**
  ```bash
  cp daily-redline.yml .github/workflows/daily-redline.yml
  ```

- [ ] **Commit workflow:**
  ```bash
  git add .github/workflows/
  git commit -m "Add GitHub Actions workflow"
  git push origin main
  ```

- [ ] **Go to GitHub repo → Settings → Secrets and variables → Actions**

- [ ] **Add ANTHROPIC_API_KEY secret:**
  - Click "New repository secret"
  - Name: `ANTHROPIC_API_KEY`
  - Value: `sk-ant-xxxxx...` (from Anthropic console)
  - Click "Add secret"

- [ ] **Add SENDGRID_API_KEY secret:**
  - Click "New repository secret"
  - Name: `SENDGRID_API_KEY`
  - Value: `SG.xxxxx...` (from SendGrid dashboard)
  - Click "Add secret"

- [ ] **Add FROM_EMAIL secret:**
  - Click "New repository secret"
  - Name: `FROM_EMAIL`
  - Value: `your-verified-email@example.com`
  - Click "Add secret"

- [ ] **Add TO_EMAIL secret:**
  - Click "New repository secret"
  - Name: `TO_EMAIL`
  - Value: `recipient@example.com`
  - Click "Add secret"

- [ ] **Verify all 4 secrets exist:**
  Go back to Secrets page and confirm you see all 4 listed.

---

## ✔️ GitHub Actions Testing

- [ ] **Go to Actions tab in your GitHub repo**

- [ ] **See "The Daily Redline Newsletter" workflow**

- [ ] **Click the workflow name**

- [ ] **Click "Run workflow"**
  - Wait for it to complete (usually 30-60 seconds)
  - Should see ✅ green check when done

- [ ] **Check your email inbox:**
  - You should receive the newsletter
  - Check spam folder if not in inbox
  - Verify it's formatted correctly

- [ ] **If workflow fails:**
  - Click into the failed run
  - Expand "Run The Daily Redline" step
  - Look for error message (usually API key or feed issue)
  - Check API key values in GitHub Secrets
  - Verify RSS feeds are accessible

---

## 📅 Scheduled Execution

- [ ] **Workflow is configured to run at 5:30 AM Pacific (1:30 PM UTC)**

- [ ] **To change the time:**
  - Edit `.github/workflows/daily-redline.yml`
  - Modify the `cron` line under `schedule:`
  - Use [crontab.guru](https://crontab.guru/) to convert times
  - Commit and push changes

- [ ] **Verify scheduled runs:**
  - Wait until next scheduled time
  - Check Actions tab
  - Should see a run start automatically
  - Check email to confirm newsletter arrived

---

## 🔍 Post-Launch Monitoring

- [ ] **Set up GitHub notifications:**
  - Watch the repository
  - Get alerts if workflow fails

- [ ] **Monitor API usage:**
  - Anthropic: [console.anthropic.com](https://console.anthropic.com/) → Usage
  - SendGrid: Dashboard → Overview
  - Watch for unexpected costs or errors

- [ ] **Set spending limits (optional but recommended):**
  - Anthropic: Set API usage limits in console
  - SendGrid: Set monthly sending limit in settings

- [ ] **Review first week of newsletters:**
  - Do subject lines look good?
  - Is content relevant?
  - Any formatting issues in your email client?

---

## 🎨 Optional Customizations

After successful deployment, consider:

- [ ] **Customize email colors:**
  Edit `generateHTML()` function in `newsletter.js`
  Change hex colors in `categoryMap`

- [ ] **Add/remove RSS feeds:**
  Edit `RSS_FEEDS` array in `newsletter.js`

- [ ] **Change email categories:**
  Modify `CATEGORY_KEYWORDS` in `newsletter.js`

- [ ] **Adjust copy style:**
  Modify the Claude prompt in Stage 3 of `newsletter.js`

- [ ] **Change daily time:**
  Update `cron` value in `.github/workflows/daily-redline.yml`

---

## 🐛 Troubleshooting Guide

| Issue | Solution |
|-------|----------|
| "Missing environment variables" | Copy `.env.example` to `.env` and fill all 4 keys |
| "ANTHROPIC_API_KEY is invalid" | Check key starts with `sk-ant-` and has no extra spaces |
| "SENDGRID_API_KEY is invalid" | Check key starts with `SG.` and verify it's an API key (not webhook key) |
| "Failed to fetch {Feed Name}" | RSS feed may be down; system will try again tomorrow |
| Email not arriving | Check spam folder; verify sender email in SendGrid Settings |
| Workflow doesn't run on schedule | Push one commit to main after adding secrets; workflows need a commit after secret creation |
| "DRY_RUN" mode works but sending fails | Verify FROM_EMAIL is verified in SendGrid Sender Authentication |
| HTML looks broken in Gmail | Table-based layout is Gmail-compatible; try different email client |

---

## ✨ Success Checklist

- [ ] All 4 API keys set correctly in `.env`
- [ ] Local test with `DRY_RUN=true` generates HTML
- [ ] Local test with `DRY_RUN=false` sends email successfully
- [ ] Email arrives in inbox (or spam folder)
- [ ] GitHub Actions workflow created in `.github/workflows/`
- [ ] All 4 secrets added to GitHub repository
- [ ] Manual workflow run in GitHub Actions succeeds
- [ ] Received email from GitHub Actions test run
- [ ] Workflow scheduled for daily execution
- [ ] No errors in Action logs

---

## 🎉 You're Done!

Your Daily Redline newsletter is now:
- ✅ Running locally on-demand
- ✅ Configured for automated daily sends
- ✅ Powered by Claude AI for intelligent curation
- ✅ Generating beautifully formatted emails

**Next steps:**
1. Let it run for a week and review quality
2. Make any customizations (colors, feeds, tone)
3. Share with subscribers
4. Monitor API costs
5. Enjoy your fully automated newsletter! 🚗

---

**Need help?** Check the README.md for detailed documentation.
