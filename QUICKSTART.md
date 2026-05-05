# ⚡ The Daily Redline - Quick Start (10 Minutes)

Get your automotive newsletter running in under 10 minutes.

---

## Step 1: Get API Keys (5 minutes)

### Anthropic Claude
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Click **API Keys** in left sidebar
4. Click **Create Key**
5. Copy the key (starts with `sk-ant-`)
6. Save it somewhere temporarily

### SendGrid Email
1. Go to https://sendgrid.com/
2. Sign up (free account, no credit card)
3. Go to **Settings → API Keys**
4. Click **Create API Key**
5. Copy the key (starts with `SG.`)
6. Save it temporarily

---

## Step 2: Setup Project (2 minutes)

```bash
# Clone or download this repository
git clone <repo-url>
cd the-daily-redline

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

---

## Step 3: Fill in Credentials (1 minute)

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxx...      # From step 1
SENDGRID_API_KEY=SG.xxxxx...           # From step 1
FROM_EMAIL=your-email@gmail.com        # Any email (will send from here)
TO_EMAIL=your-email@gmail.com          # Where newsletter goes
DRY_RUN=true                           # Keep true for testing
```

**Before sending for real:**
1. Go to SendGrid → Settings → Sender Authentication
2. Click "Verify Single Sender"
3. Add `FROM_EMAIL` address
4. Click verification link in your email

---

## Step 4: Test It (1 minute)

```bash
npm run dev
```

Should see:
```
[...] 🚀: Starting The Daily Redline...
[...] 📰: Fetching RSS feeds...
[...] ✅: Fetched 45 unique articles
[...] 🧠: Scoring articles with Claude...
[...] ✅: Newsletter copy generated
[...] 📧: DRY RUN: Skipping email send
```

Check the HTML preview:
```bash
open /tmp/daily-redline-preview.html  # macOS
# or on Linux:
cat /tmp/daily-redline-preview.html | lynx -stdin
```

---

## Step 5: Send for Real (1 minute)

Update `.env`:
```env
DRY_RUN=false
```

Run:
```bash
npm start
```

Should see:
```
[...] 📧: Sending newsletter...
[...] ✅: Newsletter sent to your-email@gmail.com
```

Check your email! 📧

---

## Step 6: Automate with GitHub (Optional, 2 minutes)

### Push to GitHub

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### Add Workflow

```bash
mkdir -p .github/workflows
cp daily-redline.yml .github/workflows/
git add .github/workflows/
git commit -m "Add workflow"
git push origin main
```

### Add Secrets

Go to **GitHub → Settings → Secrets and variables → Actions**

Add these 4 secrets:
- `ANTHROPIC_API_KEY` = your API key
- `SENDGRID_API_KEY` = your API key  
- `FROM_EMAIL` = your-email@gmail.com
- `TO_EMAIL` = your-email@gmail.com

---

## 🎉 Done!

Your newsletter is now:
- ✅ Running locally on-demand: `npm start`
- ✅ Automated to run daily at 5:30 AM Pacific (if GitHub Actions configured)
- ✅ Powered by Claude AI
- ✅ Beautifully formatted

---

## 📋 Common Issues

| Problem | Solution |
|---------|----------|
| "Missing env variables" | Make sure all 4 keys are in `.env` |
| Email shows "Unauthorized" | Double-check API key is correct (no spaces) |
| Email not arriving | Check spam folder; verify FROM_EMAIL in SendGrid |
| Workflow doesn't run | Ensure you pushed to main branch AFTER adding secrets |

---

## 🚀 Next Steps

1. **Customize:** Edit `newsletter.js` to change feeds, tone, colors
2. **Monitor:** Check GitHub Actions tab to see daily runs
3. **Share:** Give subscribers your TO_EMAIL address
4. **Enjoy:** Your fully automated newsletter! 🚗

---

See **README.md** for full documentation.

**Need help?** Check ARCHITECTURE.md for technical details.
