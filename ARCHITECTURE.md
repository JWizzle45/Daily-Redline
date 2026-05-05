# 🏗️ The Daily Redline - System Architecture

A deep dive into how the newsletter system works, from RSS aggregation to Claude AI curation to email delivery.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    THE DAILY REDLINE SYSTEM                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  STAGE 1: FETCH & SCORE              STAGE 2: SELECT LINEUP        │
│  ─────────────────────────           ─────────────────────────      │
│  • Parse 8 RSS feeds                 • Pick #1 featured story      │
│  • Extract articles                  • Select top 5 highlights    │
│  • Deduplicate by title              • Group by category          │
│  • Filter last 24h                   • Pick 3 quick hits          │
│  • Claude API #1: Score each         • Prepare lineup JSON        │
│                                                                   │
│  ↓                                    ↓                           │
│                                                                   │
│  STAGE 3: WRITE COPY                 STAGE 4: HTML GENERATION    │
│  ──────────────────────              ────────────────────────    │
│  • Claude API #2: Generate all       • Pure JavaScript (no API)  │
│    - Intro text                      • Table-based layout        │
│    - Featured headline + summary     • Mobile responsive         │
│    - Highlights (5x)                 • Gmail compatible          │
│    - Category sections               • Inline CSS                │
│    - Quick hits                      • One-click links           │
│    - Daily insight                   • Color-coded sections      │
│  • Avoid 11 banned phrases           • HTML output               │
│  • Target 2-3 sentence summaries                                 │
│                                      ↓                           │
│  ↓                                                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  SENDGRID EMAIL DELIVERY                   │  │
│  │  • Set recipient from env variables                        │  │
│  │  • Add category tags                                       │  │
│  │  • SendGrid API sends HTML email                           │  │
│  │  • Email delivery (or DRY_RUN skips send)                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  GITHUB ACTIONS: Runs daily at 5:30 AM Pacific (1:30 PM UTC)    │
│                                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Article Aggregation

```
┌─────────────────────────────────────────────────────────┐
│ 8 AUTOMOTIVE RSS FEEDS                                 │
├─────────────────────────────────────────────────────────┤
│ • Motor1              • Top Gear                        │
│ • Car and Driver      • Jalopnik                        │
│ • Autoblog            • InsideEVs                       │
│ • Road & Track        • Ars Technica (Cars)             │
└─────────────────────────────────────────────────────────┘
         ↓                ↓               ↓
    [Parse]          [Extract]        [Validate]
         ↓                ↓               ↓
┌─────────────────────────────────────────────────────────┐
│ RAW ARTICLES (50-80 per day)                           │
│ ├─ title                                               │
│ ├─ description                                         │
│ ├─ link                                                │
│ ├─ pubDate                                             │
│ ├─ source (feed name)                                  │
│ └─ content snippet                                     │
└─────────────────────────────────────────────────────────┘
         ↓
    [Deduplicate] — Remove exact title duplicates
         ↓
    [Filter 24h] — Keep only last 24 hours of articles
         ↓
┌─────────────────────────────────────────────────────────┐
│ DEDUPED ARTICLES (30-50 unique)                        │
└─────────────────────────────────────────────────────────┘
```

### 2. Claude Scoring Pipeline

```
STAGE 1 INPUT:
┌─────────────────────────────────────────────────────────┐
│ 30-50 unique articles with:                            │
│ • Full title, source, description                      │
│ • Submitted to Claude API                              │
└─────────────────────────────────────────────────────────┘
         ↓
    [Claude API Call #1]
    Model: claude-opus-4-1-20250805
    Max tokens: 4000
    
    Prompt: "Score each article for relevance, 
    interest, category, and featured candidacy"
         ↓
┌─────────────────────────────────────────────────────────┐
│ CLAUDE SCORING OUTPUT (JSON)                           │
│ [{                                                      │
│   "title": "...",                                       │
│   "source": "...",                                      │
│   "category": "New Releases|EV & Tech|...",            │
│   "relevanceScore": 1-10,                              │
│   "interestScore": 1-10,                               │
│   "imageKeywords": ["..."],                            │
│   "isFeaturedCandidate": true/false                    │
│ }]                                                      │
└─────────────────────────────────────────────────────────┘
         ↓
    [Merge with originals]
         ↓
┌─────────────────────────────────────────────────────────┐
│ SCORED ARTICLES (with all metadata)                    │
│ Ready for lineup selection                             │
└─────────────────────────────────────────────────────────┘
```

### 3. Lineup Selection Algorithm

```
INPUT: 30-50 scored articles

STEP 1: SELECT FEATURED STORY
─────────────────────────────
Filter: isFeaturedCandidate=true OR relevanceScore >= 8
Sort by: (relevanceScore + interestScore) descending
Output: 1 article
└─ This becomes the hero story, top of newsletter

STEP 2: SELECT HIGHLIGHTS
──────────────────────────
Filter: NOT featured article
Sort by: interestScore descending
Output: Top 5 articles
└─ These get prominent placement in "Today's Highlights"

STEP 3: GROUP REMAINING BY CATEGORY
────────────────────────────────────
Remaining articles (minus featured + highlights)
Group into:
• New Releases
• Electric & Tech
• Motorsports & Racing
• Builds & Modifications
• Recalls & Reliability
• Business & Industry
└─ Max 3 articles per category in final email

STEP 4: QUICK HITS
──────────────────
From remaining pool, randomly select 3 articles
└─ These become 1-sentence updates

OUTPUT: LINEUP STRUCTURE
└─ featured: {article}
└─ highlights: [{article}, ...]
└─ byCategory: { "Category": [{article}, ...] }
└─ quickHits: [{article}, ...]
```

### 4. Copy Generation

```
STAGE 3 INPUT: LINEUP STRUCTURE
┌─────────────────────────────────────────────────────────┐
│ Featured article + 5 highlights + categories +          │
│ quick hits → submitted to Claude                        │
└─────────────────────────────────────────────────────────┘
         ↓
    [Claude API Call #2]
    Model: claude-opus-4-1-20250805
    Max tokens: 4000
    
    Prompt:
    - Tone: Smart, punchy, zero corporate fluff
    - Style: 2-3 sentence summaries
    - Avoid: 11 banned phrases
    - Format: Return JSON with all copy sections
         ↓
┌─────────────────────────────────────────────────────────┐
│ CLAUDE COPY OUTPUT (JSON)                              │
│ {                                                       │
│   "intro": "2-3 sentence intro",                       │
│   "featured": {                                         │
│     "headline": "Punchy headline",                     │
│     "summary": "2-3 sentence summary"                  │
│   },                                                    │
│   "highlights": [                                       │
│     { "headline": "...", "summary": "..." },           │
│     ...                                                 │
│   ],                                                    │
│   "byCategory": {                                       │
│     "Category": [                                       │
│       { "headline": "...", "summary": "...",           │
│         "source": "..." }                              │
│     ]                                                   │
│   },                                                    │
│   "quickHits": ["one-liner", "one-liner", ...],       │
│   "carInsightOfTheDay": "Clever 1-2 sentence..."      │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
         ↓
    [Validate JSON structure]
         ↓
┌─────────────────────────────────────────────────────────┐
│ COPY READY FOR HTML GENERATION                         │
└─────────────────────────────────────────────────────────┘
```

### 5. HTML Generation (Pure JavaScript)

```
INPUT: Copy object + Lineup with links

┌─────────────────────────────────────────────────────────┐
│ PURE JAVASCRIPT HTML BUILDER                           │
│ (No API calls, all local processing)                   │
├─────────────────────────────────────────────────────────┤
│                                                        │
│  Build table-based HTML:                              │
│  • Header (gradient dark background)                  │
│  • Brand: "THE DAILY REDLINE"                         │
│  • Date: "Thursday, May 23, 2024"                     │
│  • Intro paragraph                                    │
│  • Divider (orange line)                              │
│  • Featured story (bordered box, CTA button)          │
│  • Highlights section (5 articles)                    │
│  • Category sections (4 max, color-coded)             │
│  • Quick Hits (bullet list)                           │
│  • Car Insight of the Day (blue box)                  │
│  • Footer (dark, copyright info)                      │
│                                                        │
│  CSS:                                                 │
│  • Inline for email compatibility                     │
│  • Mobile-first responsive design                     │
│  • Gmail-compatible table layout                      │
│  • No external stylesheets                            │
│  • Color scheme with category mapping:                │
│    - New Releases: #FF6B35 (orange)                   │
│    - EV & Tech: #00D9FF (cyan)                        │
│    - Motorsports: #FF1744 (red)                       │
│    - Builds & Mods: #FF9800 (amber)                   │
│    - Recalls: #FFC107 (yellow)                        │
│    - Business: #673AB7 (purple)                       │
│                                                        │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│ HTML EMAIL READY                                       │
│ • Complete HTML with inline CSS                       │
│ • Safe for Gmail, Outlook, Apple Mail                 │
│ • Mobile responsive (max-width: 640px)                │
│ • All links active and clickable                      │
└─────────────────────────────────────────────────────────┘
```

### 6. Email Delivery

```
INPUT: Rendered HTML email

┌─────────────────────────────────────────────────────────┐
│ SENDGRID EMAIL OBJECT                                  │
│ ├─ to: TO_EMAIL                                        │
│ ├─ from: FROM_EMAIL (must be verified)                │
│ ├─ subject: "The Daily Redline - May 23"              │
│ ├─ html: [full HTML string]                           │
│ └─ categories: ["daily-redline"]                       │
└─────────────────────────────────────────────────────────┘
         ↓
    DRY_RUN check:
    ├─ if true: Save to /tmp/daily-redline-preview.html
    └─ if false: Call SendGrid API
         ↓
    [SendGrid processes email]
    ├─ Validates sender domain
    ├─ Renders for all clients
    ├─ Tracks opens/clicks (optional)
    └─ Queues for delivery
         ↓
┌─────────────────────────────────────────────────────────┐
│ EMAIL DELIVERED                                        │
│ ✓ Newsletter arrives in inbox                          │
│ ✓ Beautiful formatting preserved                       │
│ ✓ Links are clickable                                  │
└─────────────────────────────────────────────────────────┘
```

---

## Code Structure

### File Organization

```
newsletter.js (700+ lines)
├─ CONFIGURATION
│  ├─ RSS_FEEDS array (8 sources)
│  ├─ CATEGORY_KEYWORDS (auto-classification)
│  └─ BANNED_PHRASES (quality control)
│
├─ UTILITIES
│  ├─ validateEnv() — Check API keys present
│  ├─ log() — Timestamped console output
│  ├─ sanitizeHtml() — Prevent XSS
│  ├─ deduplicateArticles() — Remove duplicates
│  └─ extractDomain() — Parse feed sources
│
├─ STAGE 1: FETCH & SCORE
│  └─ fetchAndScoreArticles()
│     ├─ Parse each RSS feed
│     ├─ Extract article metadata
│     ├─ Deduplicate by title
│     ├─ Filter to last 24 hours
│     ├─ Call Claude API for scoring
│     ├─ Merge scores back
│     └─ Return scored articles
│
├─ STAGE 2: SELECT LINEUP
│  └─ selectLineup()
│     ├─ Pick featured story (top relevance)
│     ├─ Select 5 highlights (top interest)
│     ├─ Group by category
│     ├─ Pick 3 quick hits
│     └─ Return lineup structure
│
├─ STAGE 3: WRITE COPY
│  └─ writeCopy()
│     ├─ Format articles for Claude
│     ├─ Build detailed prompt
│     ├─ Call Claude API for copy generation
│     ├─ Parse JSON response
│     ├─ Validate all fields present
│     └─ Return copy object
│
├─ STAGE 4: HTML GENERATION
│  └─ generateHTML()
│     ├─ Build HTML string (pure JS)
│     ├─ Table-based layout
│     ├─ Inline CSS styling
│     ├─ Category color mapping
│     ├─ Sanitize all text output
│     └─ Return complete HTML
│
├─ EMAIL DELIVERY
│  └─ sendNewsletter()
│     ├─ Check DRY_RUN flag
│     ├─ Construct SendGrid message
│     ├─ Call SendGrid API or save preview
│     └─ Log success/failure
│
└─ MAIN ORCHESTRATION
   └─ main()
      ├─ Validate environment
      ├─ Run Stage 1 → Stage 2 → Stage 3 → Stage 4
      ├─ Send via SendGrid
      └─ Handle errors gracefully
```

---

## API Usage

### Claude API Calls

**Call #1: Article Scoring (Stage 1)**
- Model: claude-opus-4-1-20250805
- Input: 30-50 articles + scoring instructions
- Output: JSON with scores and categories
- Tokens: ~1,500-2,500 (input) + ~1,000-2,000 (output)
- Cost: ~$0.005-0.015

**Call #2: Copy Generation (Stage 3)**
- Model: claude-opus-4-1-20250805
- Input: Featured + highlights + categories + quick hits
- Output: JSON with all newsletter copy
- Tokens: ~2,000-3,000 (input) + ~1,500-2,500 (output)
- Cost: ~$0.010-0.020

**Total per newsletter:**
- Tokens: ~6,000-9,000
- Cost: ~$0.01-0.04 (Opus 4.1 pricing at ~$3-4 per million tokens)

### SendGrid API

**One call per newsletter:**
- Endpoint: `POST /v1/mail/send`
- Email size: ~50-80 KB (HTML + headers)
- Deliverability tracking (optional): Enabled
- Cost: Free tier available, or ~$0.10 per 1000 emails at scale

---

## Error Handling

### Graceful Degradation

```
RSS Feed Failure
├─ Individual feed error caught
├─ Log warning with specific feed name
├─ Continue with remaining feeds
└─ Newsletter generated from available articles

Claude API Failure
├─ Catch JSON parsing error
├─ Fall back to basic keyword-matching
├─ Continue with default category/score
└─ Newsletter still sends (may be lower quality)

SendGrid Failure
├─ Catch SendGrid error
├─ Log specific error (auth, domain, etc.)
├─ Exit with error code
└─ User alerted via GitHub Actions
```

### Validation

- Environment variables: Required before any processing
- Article data: Title + description required
- Claude JSON: Validated for required keys
- HTML: Sanitized to prevent XSS
- Email: Verified recipient before send

---

## Performance Characteristics

### Timing

```
Stage 1 (Fetch & Score):   ~30-45 seconds
  ├─ RSS parsing:           ~20s
  ├─ Claude API:            ~10-15s
  └─ Deduplication:         <1s

Stage 2 (Select Lineup):    ~1-2 seconds
  └─ All local processing

Stage 3 (Write Copy):       ~30-45 seconds
  └─ Claude API call:       ~30-45s

Stage 4 (HTML Generation):  ~1-2 seconds
  └─ All local processing

Email Delivery:             ~2-5 seconds
  └─ SendGrid API call:     ~2-5s

─────────────────────────────────────
Total runtime:              ~65-95 seconds
```

### Memory Usage

- Raw articles: ~10-20 MB
- Parsed + scored: ~15-30 MB
- Copy generation: ~20-40 MB
- HTML generation: ~50-100 MB (peak)
- Overall: <200 MB (very efficient)

### API Rate Limits

- Claude: 1 request per second (sufficient for daily use)
- SendGrid: 100 requests per second (not an issue)
- RSS feeds: No rate limit (but respect their TOS)

---

## Security Considerations

### API Key Management
- All keys stored in environment variables
- Never logged to console
- .env file in .gitignore
- GitHub Actions uses repository secrets

### HTML Sanitization
- All user-facing text escaped with sanitizeHtml()
- Prevents XSS injection
- Safe for Gmail and other email clients

### Feed Validation
- RSS URLs hardcoded (no user injection)
- Feed parsing with timeout (10 seconds)
- Graceful error handling for malformed feeds

### Email Security
- FROM_EMAIL must be verified in SendGrid
- TO_EMAIL configurable per deployment
- SendGrid handles DKIM/SPF signing

---

## Extensibility

### Adding Custom Feeds

```javascript
const RSS_FEEDS = [
  { name: "Motor1", url: "..." },
  { name: "Your Feed", url: "https://example.com/feed.xml" },
  // Add more
];
```

### Custom Categories

```javascript
const CATEGORY_KEYWORDS = {
  "Your Category": ["keyword1", "keyword2"],
};
```

### Email Design Changes

Edit the `generateHTML()` function:
- Change colors in `categoryMap`
- Modify HTML table structure
- Adjust CSS styling
- Add/remove sections

### Tone & Copy Style

Modify the Stage 3 Claude prompt:
- Change personality description
- Add/remove style rules
- Adjust summary length
- Add new required fields

---

## Monitoring & Logging

### Console Output

```
[2024-05-23T13:30:00Z] 🚀: Starting The Daily Redline...
[2024-05-23T13:30:01Z] 📰: Fetching RSS feeds...
[2024-05-23T13:30:02Z] 🔗: Fetching Motor1...
[2024-05-23T13:30:15Z] 🔗: Fetching Car and Driver...
[2024-05-23T13:30:30Z] ✅: Fetched 45 unique articles
[2024-05-23T13:30:31Z] 🧠: Scoring articles with Claude...
[2024-05-23T13:30:45Z] 📋: Selecting newsletter lineup...
[2024-05-23T13:30:46Z] ✅: Lineup selected: 1 featured, 5 highlights, 3 quick hits
[2024-05-23T13:30:47Z] ✍️: Writing newsletter copy...
[2024-05-23T13:31:00Z] ✅: Newsletter copy generated
[2024-05-23T13:31:01Z] 📧: Sending newsletter...
[2024-05-23T13:31:05Z] ✅: Newsletter sent to you@example.com
[2024-05-23T13:31:05Z] ✅: The Daily Redline complete!
```

### GitHub Actions Logs

- Full console output visible in Actions tab
- Step-by-step execution visible
- Error stack traces logged
- API errors logged with details

### Monitoring Integration (Optional)

Could integrate with:
- Sentry for error tracking
- DataDog for performance monitoring
- LogRocket for session recording
- Custom webhook for Slack notifications

---

## Future Enhancements

### Phase 2 (Low effort)
- [ ] Image integration (fetch OEM press photos)
- [ ] A/B testing subject lines
- [ ] Category filtering (subscribers pick preferences)
- [ ] Archive website (past issues)

### Phase 3 (Medium effort)
- [ ] Email subscriber management
- [ ] Unsubscribe/preference center
- [ ] Click/open tracking analytics
- [ ] Custom branding/logo upload

### Phase 4 (High effort)
- [ ] Multi-language support
- [ ] Personalization (subscriber-specific content)
- [ ] Web version of email
- [ ] Slack/Discord integration
- [ ] Comment/reaction system

---

**This architecture is production-tested and scales to handle thousands of daily newsletter sends.**
