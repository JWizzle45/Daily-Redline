#!/usr/bin/env node

/**
 * THE DAILY DRIVE — Automated Newsletter
 * ======================================
 * Multi-stage Claude pipeline:
 *   Stage 1: Fetch + categorize + score articles
 *   Stage 2: Select featured story, highlights, lineup
 *   Stage 3: Write newsletter copy (summaries, intro, fact, etc.)
 *   Stage 4: Generate full HTML email (pure JS — no extra Claude call)
 *
 * Run:          node auto-newsletter.js
 * Dry run:      DRY_RUN=true node auto-newsletter.js
 */

"use strict";

const Parser    = require("rss-parser");
const Anthropic = require("@anthropic-ai/sdk");
const sgMail    = require("@sendgrid/mail");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const CONFIG = {
  ANTHROPIC_API_KEY : process.env.ANTHROPIC_API_KEY,
  SENDGRID_API_KEY  : process.env.SENDGRID_API_KEY,
  FROM_EMAIL        : process.env.FROM_EMAIL,
  TO_EMAIL          : process.env.TO_EMAIL,
  DRY_RUN           : process.env.DRY_RUN === "true",
  MAX_ARTICLES      : parseInt(process.env.MAX_ARTICLES || "20", 10),
  MODEL             : "claude-sonnet-4-5",
  MAX_TOKENS        : 8000,
};

const REQUIRED = CONFIG.DRY_RUN
  ? ["FROM_EMAIL", "TO_EMAIL"]
  : ["ANTHROPIC_API_KEY", "SENDGRID_API_KEY", "FROM_EMAIL", "TO_EMAIL"];

const missing = REQUIRED.filter((k) => !CONFIG[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// ─────────────────────────────────────────────
// RSS FEEDS — Automotive News Sources
// ─────────────────────────────────────────────

const RSS_FEEDS = [
  "https://feeds.bloomberg.com/markets/news.rss",           // Bloomberg — auto news
  "https://www.cnbc.com/id/100003114/device/rss/rss.html",  // CNBC — auto industry
  "https://jalopnik.com/rss",                                // Jalopnik — car culture
  "https://www.theverge.com/cars/rss/index.xml",            // The Verge — auto tech
  "https://www.roadandtrack.com/feeds/latest.xml",          // Road & Track
  "https://feeds.autoblog.com/weblog/",                     // AutoBlog
  // "https://www.caranddriver.com/rss/all.xml",            // Car and Driver
  // "https://www.motortrend.com/feeds/latest.xml",         // MotorTrend
];

// ─────────────────────────────────────────────
// FALLBACK IMAGES (Unsplash — free, no key needed)
// Used when an article has no image or a low relevance score.
// ─────────────────────────────────────────────

const FALLBACK_IMAGES = {
  "EV & Battery Tech"      : "https://images.unsplash.com/photo-1560958089-b8a63dd89c94?w=600&auto=format&fit=crop&q=80",
  "Motorsports & Racing"   : "https://images.unsplash.com/photo-1579399788625-e7abb4bb9d3f?w=600&auto=format&fit=crop&q=80",
  "Luxury & Performance"   : "https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=600&auto=format&fit=crop&q=80",
  "Industry & Market"      : "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=600&auto=format&fit=crop&q=80",
  "Autonomous & Connected" : "https://images.unsplash.com/photo-1581092163825-8f18f41531bd?w=600&auto=format&fit=crop&q=80",
  "Design & Innovation"    : "https://images.unsplash.com/photo-1533473359331-35acda7ce3f1?w=600&auto=format&fit=crop&q=80",
  "Quick Hits"             : "https://images.unsplash.com/photo-1594882645126-14020914d58d?w=600&auto=format&fit=crop&q=80",
  default                  : "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&auto=format&fit=crop&q=80",
};

// ─────────────────────────────────────────────
// DESIGN TOKENS
// Sleek automotive color scheme
// ─────────────────────────────────────────────

const D = {
  charcoal  : "#1a1a1a",
  gunmetal  : "#2d2d2d",
  steel     : "#3a3a3a",
  silver    : "#e8e8e8",
  accent    : "#ff4500",  // vibrant orange
  accentAlt : "#00bfff",  // electric blue
  bg        : "#0f0f0f",
  cardBg    : "#1f1f1f",
  text      : "#ffffff",
  muted     : "#999999",
  factBg    : "#2a2a2a",
  factBorder: "#ff4500",
};

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function getDisplayDate() {
  const now = new Date();
  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  return now.toLocaleDateString("en-US", options);
}

// ─────────────────────────────────────────────
// STAGE 1: FETCH + SCORE + CATEGORIZE
// ─────────────────────────────────────────────

async function fetchAndScoreArticles() {
  log("STAGE 1: Fetching and scoring articles...");
  const parser = new Parser();
  const allArticles = [];

  for (const feed of RSS_FEEDS) {
    try {
      const data = await parser.parseURL(feed);
      for (const item of (data.items || []).slice(0, 5)) {
        if (item.title && item.link) {
          allArticles.push({
            title: item.title,
            link: item.link,
            source: data.title || "Unknown",
            description: item.content || item.description || "",
            image: item.image?.url || item.enclosure?.url || "",
            pubDate: item.pubDate || new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      log(`⚠ Failed to fetch ${feed}: ${e.message}`);
    }
  }

  // Slice to MAX_ARTICLES
  const articles = allArticles.slice(0, CONFIG.MAX_ARTICLES);
  log(`Fetched ${articles.length} articles from ${RSS_FEEDS.length} feeds.`);

  if (articles.length === 0) {
    log("ERROR: No articles fetched. Exiting.");
    process.exit(1);
  }

  // Stage 1 Claude call: Score and categorize
  const client = new Anthropic();
  const articleList = articles
    .map((a, i) => `${i + 1}. "${a.title}" (${a.source})\n   ${a.description.slice(0, 150)}`)
    .join("\n");

  const stage1Prompt = `You are an automotive news curator. Score and categorize each article for relevance to automotive enthusiasts.

ARTICLES:
${articleList}

Respond ONLY with a JSON object (no markdown, no preamble):
{
  "articles": [
    {
      "index": 1,
      "relevance_score": 5,
      "category": "EV & Battery Tech",
      "relevance_explanation": "Direct EV news"
    },
    ...
  ]
}

Categories: EV & Battery Tech, Motorsports & Racing, Luxury & Performance, Industry & Market, Autonomous & Connected, Design & Innovation, Quick Hits

Scores: 1-5 (5=highly relevant, 1=barely relevant)`;

  const stage1Response = await client.messages.create({
    model: CONFIG.MODEL,
    max_tokens: CONFIG.MAX_TOKENS,
    messages: [{ role: "user", content: stage1Prompt }],
  });

  let stage1Data = { articles: [] };
  try {
    const text = (stage1Response.content[0].text || "").replace(/```json|```/g, "").trim();
    stage1Data = JSON.parse(text);
  } catch (e) {
    log(`⚠ Stage 1 JSON parse error: ${e.message}. Using fallback.`);
  }

  // Enrich articles with scores
  const scoredArticles = articles.map((a, i) => {
    const scored = stage1Data.articles.find((s) => s.index === i + 1);
    return {
      ...a,
      relevance_score: scored?.relevance_score || 3,
      category: scored?.category || "Quick Hits",
      explanation: scored?.relevance_explanation || "",
    };
  });

  log(`✓ Stage 1 complete. Scored ${scoredArticles.length} articles.`);
  return scoredArticles;
}

// ─────────────────────────────────────────────
// STAGE 2: SELECT FEATURED + HIGHLIGHTS + LINEUP
// ─────────────────────────────────────────────

async function selectLayout(articles) {
  log("STAGE 2: Selecting featured story and layout...");
  const client = new Anthropic();

  const topArticles = articles
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 12)
    .map(
      (a, i) =>
        `${i + 1}. "${a.title}" (${a.category}, score: ${a.relevance_score}/5)\n   Source: ${a.source}`
    )
    .join("\n");

  const stage2Prompt = `You are a newsletter editor. Given these top automotive articles, select:
- 1 featured/hero story (the most engaging, surprising, or important)
- 3 "highlight" stories (secondary, but compelling)
- The remaining articles as "quick hits"

TOP ARTICLES:
${topArticles}

Respond ONLY with JSON (no markdown):
{
  "featured_index": 1,
  "highlights_indices": [2, 3, 4],
  "rationale": "Featured story is most impactful..."
}`;

  const stage2Response = await client.messages.create({
    model: CONFIG.MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: stage2Prompt }],
  });

  let layout = { featured_index: 1, highlights_indices: [2, 3, 4], rationale: "" };
  try {
    const text = (stage2Response.content[0].text || "").replace(/```json|```/g, "").trim();
    layout = JSON.parse(text);
  } catch (e) {
    log(`⚠ Stage 2 JSON parse error: ${e.message}. Using defaults.`);
  }

  log(`✓ Stage 2 complete. Featured: index ${layout.featured_index}`);
  return layout;
}

// ─────────────────────────────────────────────
// STAGE 3: WRITE NEWSLETTER COPY
// ─────────────────────────────────────────────

async function writeCopy(articles, layout) {
  log("STAGE 3: Writing newsletter copy...");
  const client = new Anthropic();

  const topArticles = articles.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 12);
  const featured = topArticles[layout.featured_index - 1] || topArticles[0];
  const highlights = layout.highlights_indices.map((i) => topArticles[i - 1]).filter(Boolean);

  const stage3Prompt = `You are a professional automotive newsletter writer. Write concise, engaging copy for "The Daily Drive" newsletter.

FEATURED STORY:
"${featured.title}"
${featured.description.slice(0, 200)}

Write ONLY JSON (no markdown):
{
  "intro_line": "Gear up for today's automotive headlines...",
  "featured_teaser": "A 1-sentence hook for the featured story.",
  "featured_summary": "2-3 sentences summarizing the featured story with insight.",
  "featured_cta": "Read more →",
  "highlights_teasers": [
    "Highlight 1 teaser",
    "Highlight 2 teaser",
    "Highlight 3 teaser"
  ],
  "dive_fact": "A fun, surprising fact about cars, automotive history, or EV technology."
}`;

  const stage3Response = await client.messages.create({
    model: CONFIG.MODEL,
    max_tokens: CONFIG.MAX_TOKENS,
    messages: [{ role: "user", content: stage3Prompt }],
  });

  let copy = {
    intro_line: "Your daily dose of automotive news.",
    featured_teaser: "Featured story awaits.",
    featured_summary: "Breaking automotive news.",
    featured_cta: "Read more",
    highlights_teasers: ["Story 1", "Story 2", "Story 3"],
    dive_fact: "Did you know? Cars have changed the world.",
  };

  try {
    const text = (stage3Response.content[0].text || "").replace(/```json|```/g, "").trim();
    copy = JSON.parse(text);
  } catch (e) {
    log(`⚠ Stage 3 JSON parse error: ${e.message}. Using fallback copy.`);
  }

  log(`✓ Stage 3 complete. Copy written.`);
  return { featured, highlights, copy };
}

// ─────────────────────────────────────────────
// STAGE 4: BUILD HTML EMAIL
// ─────────────────────────────────────────────

function buildHTML(articles, featured, highlights, copy) {
  log("STAGE 4: Building HTML email...");

  // Track images used to avoid duplicates
  const usedImages = new Set();

  function getImageForArticle(article) {
    if (article.image && article.relevance_score >= 3 && !usedImages.has(article.image)) {
      usedImages.add(article.image);
      return article.image;
    }
    const fallback = FALLBACK_IMAGES[article.category] || FALLBACK_IMAGES.default;
    if (!usedImages.has(fallback)) {
      usedImages.add(fallback);
      return fallback;
    }
    return FALLBACK_IMAGES.default;
  }

  const featuredImage = getImageForArticle(featured);
  const highlightImages = highlights.map((a) => getImageForArticle(a));
  const quickHits = articles
    .filter((a) => !highlights.includes(a) && a !== featured)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 4);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Daily Drive — Automotive Newsletter</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: ${D.bg};
      color: ${D.text};
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: ${D.charcoal};
    }
    .header {
      background: linear-gradient(135deg, ${D.charcoal} 0%, ${D.gunmetal} 100%);
      padding: 40px 20px;
      text-align: center;
      border-bottom: 3px solid ${D.accent};
    }
    .header h1 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -1px;
    }
    .header .tagline {
      color: ${D.accentAlt};
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .date {
      color: ${D.muted};
      font-size: 12px;
      margin-top: 12px;
    }
    .intro {
      padding: 30px 20px;
      background: ${D.gunmetal};
      font-size: 15px;
      color: ${D.silver};
      border-left: 4px solid ${D.accentAlt};
    }
    .featured {
      background: ${D.cardBg};
      margin: 20px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid ${D.steel};
      transition: transform 0.3s ease;
    }
    .featured img {
      width: 100%;
      height: 280px;
      object-fit: cover;
      display: block;
    }
    .featured-content {
      padding: 24px;
    }
    .featured-label {
      color: ${D.accent};
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
      font-weight: 700;
    }
    .featured h2 {
      font-size: 22px;
      margin-bottom: 12px;
      line-height: 1.3;
      color: ${D.text};
    }
    .featured-summary {
      font-size: 14px;
      color: ${D.silver};
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .featured-meta {
      font-size: 12px;
      color: ${D.muted};
      margin-bottom: 12px;
    }
    .cta-button {
      display: inline-block;
      background: ${D.accent};
      color: ${D.charcoal};
      padding: 10px 16px;
      border-radius: 4px;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .highlights {
      padding: 30px 20px;
      background: ${D.gunmetal};
    }
    .highlights h3 {
      color: ${D.accent};
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 20px;
      font-weight: 700;
    }
    .highlight-item {
      display: flex;
      gap: 16px;
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid ${D.steel};
    }
    .highlight-item:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    .highlight-image {
      width: 100px;
      height: 100px;
      border-radius: 4px;
      flex-shrink: 0;
      object-fit: cover;
    }
    .highlight-content h4 {
      font-size: 14px;
      margin-bottom: 6px;
      line-height: 1.3;
      color: ${D.text};
    }
    .highlight-content p {
      font-size: 12px;
      color: ${D.silver};
      line-height: 1.4;
    }
    .highlight-link {
      color: ${D.accentAlt};
      text-decoration: none;
      font-weight: 600;
      font-size: 11px;
    }
    .quick-hits {
      padding: 30px 20px;
      background: ${D.charcoal};
    }
    .quick-hits h3 {
      color: ${D.accentAlt};
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 16px;
      font-weight: 700;
    }
    .quick-hit {
      margin-bottom: 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid ${D.steel};
    }
    .quick-hit:last-child {
      border-bottom: none;
      margin-bottom: 0;
    }
    .quick-hit a {
      color: ${D.silver};
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      display: block;
      margin-bottom: 4px;
    }
    .quick-hit a:hover {
      color: ${D.accentAlt};
    }
    .quick-hit-meta {
      color: ${D.muted};
      font-size: 11px;
    }
    .fact-box {
      background: ${D.factBg};
      border-left: 4px solid ${D.factBorder};
      padding: 20px;
      margin: 30px 20px;
      border-radius: 4px;
      font-size: 14px;
      line-height: 1.6;
    }
    .fact-box strong {
      color: ${D.accent};
    }
    .footer {
      background: ${D.gunmetal};
      padding: 20px;
      text-align: center;
      border-top: 1px solid ${D.steel};
      font-size: 12px;
      color: ${D.muted};
    }
    .footer a {
      color: ${D.accentAlt};
      text-decoration: none;
    }
    @media (max-width: 600px) {
      .highlight-item { flex-direction: column; }
      .highlight-image { width: 100%; height: 150px; }
      .featured h2 { font-size: 18px; }
      .header h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚙️ THE DAILY DRIVE</h1>
      <div class="tagline">Automotive News & Insights</div>
      <div class="date">${getDisplayDate()}</div>
    </div>

    <div class="intro">
      ${copy.intro_line}
    </div>

    <div class="featured">
      <img src="${featuredImage}" alt="${featured.title}">
      <div class="featured-content">
        <div class="featured-label">🔥 Featured Story</div>
        <h2>${featured.title}</h2>
        <div class="featured-meta">${featured.source}</div>
        <p class="featured-summary">${copy.featured_summary}</p>
        <a href="${featured.link}" class="cta-button">${copy.featured_cta}</a>
      </div>
    </div>

    <div class="highlights">
      <h3>📰 Top Stories</h3>
      ${highlights
        .map(
          (h, i) => `
        <div class="highlight-item">
          <img src="${highlightImages[i]}" alt="${h.title}" class="highlight-image">
          <div class="highlight-content">
            <h4>${h.title}</h4>
            <p>${copy.highlights_teasers[i] || h.description.slice(0, 60)}</p>
            <a href="${h.link}" class="highlight-link">Read more →</a>
          </div>
        </div>
      `
        )
        .join("")}
    </div>

    <div class="quick-hits">
      <h3>⚡ Quick Hits</h3>
      ${quickHits
        .map(
          (q) => `
        <div class="quick-hit">
          <a href="${q.link}">${q.title}</a>
          <div class="quick-hit-meta">${q.source}</div>
        </div>
      `
        )
        .join("")}
    </div>

    <div class="fact-box">
      <strong>🏁 Gear Fact:</strong> ${copy.dive_fact}
    </div>

    <div class="footer">
      <p>The Daily Drive is your daily source for automotive news.</p>
      <p style="margin-top: 10px; font-size: 11px;">
        <a href="%unsubscribe_link%">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;

  log("✓ Stage 4 complete. HTML built.");
  return html;
}

// ─────────────────────────────────────────────
// SEND EMAIL
// ─────────────────────────────────────────────

async function sendNewsletter(html) {
  if (CONFIG.DRY_RUN) {
    log("DRY_RUN: Skipping SendGrid. HTML written to stdout (truncated).");
    console.log(html.slice(0, 500) + "...[truncated]");
    return;
  }

  log("Sending via SendGrid...");
  sgMail.setApiKey(CONFIG.SENDGRID_API_KEY);

  const msg = {
    to: CONFIG.TO_EMAIL,
    from: CONFIG.FROM_EMAIL,
    subject: `⚙️ The Daily Drive — ${getDisplayDate()}`,
    html,
  };

  try {
    await sgMail.send(msg);
    log(`✓ Email sent successfully to ${CONFIG.TO_EMAIL}`);
  } catch (error) {
    log(`ERROR sending email: ${error.message}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

(async () => {
  try {
    const articles = await fetchAndScoreArticles();
    const layout = await selectLayout(articles);
    const { featured, highlights, copy } = await writeCopy(articles, layout);
    const html = buildHTML(articles, featured, highlights, copy);
    await sendNewsletter(html);
    log("✓ Newsletter complete!");
  } catch (error) {
    log(`FATAL: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
    process.exit(1);
  }
})();
