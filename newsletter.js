#!/usr/bin/env node

import Parser from "rss-parser";
import { Anthropic } from "@anthropic-ai/sdk";
import * as sgMail from "@sendgrid/mail";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { URL } from "url";

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const RSS_FEEDS = [
  { name: "Motor1", url: "https://www.motor1.com/feed/rss/" },
  {
    name: "Car and Driver",
    url: "https://www.caranddriver.com/feed/rss/",
  },
  { name: "Top Gear", url: "https://www.topgear.com/feed" },
  { name: "Jalopnik", url: "https://jalopnik.com/feed" },
  { name: "InsideEVs", url: "https://insideevs.com/feed/" },
  { name: "Autoblog", url: "https://www.autoblog.com/feed/" },
  { name: "Road & Track", url: "https://www.roadandtrack.com/feed.rss" },
  {
    name: "Ars Technica - Cars",
    url: "https://arstechnica.com/feed/?content=cars",
  },
];

const CATEGORY_KEYWORDS = {
  "New Releases": [
    "new model",
    "unveiled",
    "announced",
    "debut",
    "launch",
    "first look",
    "reveal",
    "introducing",
  ],
  "Electric & Tech": [
    "ev",
    "electric",
    "battery",
    "autonomous",
    "software",
    "tesla",
    "lucid",
    "rivian",
    "ai",
    "autonomous",
  ],
  "Motorsports & Racing": [
    "formula 1",
    "f1",
    "nascar",
    "racing",
    "race",
    "championship",
    "wec",
    "indycar",
    "moto",
    "motogp",
    "track",
  ],
  "Builds & Modifications": [
    "build",
    "modification",
    "tuning",
    "custom",
    "engine",
    "swap",
    "upgrade",
    "performance",
    "horsepower",
  ],
  "Recalls & Reliability": [
    "recall",
    "reliability",
    "issue",
    "problem",
    "failure",
    "defect",
    "safety",
    "lawsuit",
  ],
  "Business & Industry": [
    "acquisition",
    "merger",
    "bankruptcy",
    "ceo",
    "executive",
    "deal",
    "partnership",
    "investment",
    "stock",
  ],
};

const BANNED_PHRASES = [
  "groundbreaking",
  "cutting-edge",
  "innovative solution",
  "pushes boundaries",
  "highlights the importance",
  "in today's fast-paced world",
  "it is worth noting",
  "furthermore",
  "this showcases",
  "game-changing",
  "revolutionary",
];

// ============================================================================
// UTILITIES
// ============================================================================

function validateEnv() {
  const required = [
    "ANTHROPIC_API_KEY",
    "SENDGRID_API_KEY",
    "FROM_EMAIL",
    "TO_EMAIL",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
    console.error("📝 Copy .env.example to .env and fill in your keys");
    process.exit(1);
  }
}

function log(label, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${label}: ${message}`);
}

function sanitizeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function deduplicateArticles(articles) {
  const seen = new Set();
  const deduped = [];

  for (const article of articles) {
    const key = (article.title || "").toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(article);
    }
  }

  return deduped;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "unknown";
  }
}

// ============================================================================
// STAGE 1: FETCH + CATEGORIZE + SCORE
// ============================================================================

async function fetchAndScoreArticles() {
  log("📰", "Fetching RSS feeds...");

  const parser = new Parser({
    timeout: 10000,
    customFields: {
      item: [["media:content", "mediaContent"]],
    },
  });

  let allArticles = [];

  for (const feed of RSS_FEEDS) {
    try {
      log("🔗", `Fetching ${feed.name}...`);
      const parsed = await parser.parseURL(feed.url);

      const feedArticles = (parsed.items || [])
        .slice(0, 10)
        .map((item) => ({
          title: item.title || "Untitled",
          description: item.contentSnippet || item.summary || "",
          link: item.link || "",
          pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
          source: feed.name,
          image: item.image?.url || item.mediaContent?.url || null,
          content: item.content || item.description || "",
        }))
        .filter((a) => a.title && a.description);

      allArticles = allArticles.concat(feedArticles);
    } catch (err) {
      log("⚠️", `Failed to fetch ${feed.name}: ${err.message}`);
    }
  }

  // Deduplicate by title
  allArticles = deduplicateArticles(allArticles);

  // Keep last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  allArticles = allArticles.filter((a) => a.pubDate > twentyFourHoursAgo);

  log("✅", `Fetched ${allArticles.length} unique articles`);

  // Score articles with Claude
  log("🧠", "Scoring articles with Claude...");

  const client = new Anthropic();

  const articlesText = allArticles
    .map(
      (a, i) =>
        `[${i}] "${a.title}" (${a.source})\n${a.description.substring(0, 300)}`
    )
    .join("\n\n");

  const message = await client.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: `You are an automotive industry expert and newsletter curator for "The Daily Redline" - a premium daily email for car enthusiasts.

Analyze these automotive articles and score them. Return ONLY valid JSON (no markdown, no code blocks).

For each article, determine:
1. category: one of [New Releases, Electric & Tech, Motorsports & Racing, Builds & Modifications, Recalls & Reliability, Business & Industry, Industry & Business, Highlights]
2. relevanceScore: 1-10 (how important to car enthusiasts)
3. interestScore: 1-10 (how interesting/engaging)
4. imageKeywords: 3-5 words for finding good images
5. isFeaturedCandidate: true if top 3 stories

Focus on real-world impact, ownership implications, and enthusiast perspective.

Articles:
${articlesText}

Return JSON array with keys: title, source, category, relevanceScore, interestScore, imageKeywords, isFeaturedCandidate

Example format:
[
  {
    "title": "New Porsche 911 Hybrid Announced",
    "source": "Motor1",
    "category": "New Releases",
    "relevanceScore": 9,
    "interestScore": 8,
    "imageKeywords": ["Porsche 911", "hybrid", "sports car"],
    "isFeaturedCandidate": true
  }
]`,
      },
    ],
  });

  let scoredArticles = [];
  try {
    const content = message.content[0].text;
    const cleanJson = content.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    scoredArticles = parsed;
  } catch (err) {
    log("⚠️", `Failed to parse Claude response: ${err.message}`);
    log("📝", "Using fallback scoring...");

    // Fallback: basic keyword matching
    scoredArticles = allArticles.map((a) => {
      let category = "Highlights";
      let relevanceScore = 5;
      let interestScore = 5;

      for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some((kw) => a.title.toLowerCase().includes(kw))) {
          category = cat;
          relevanceScore = 7;
          interestScore = 7;
          break;
        }
      }

      return {
        title: a.title,
        source: a.source,
        category,
        relevanceScore,
        interestScore,
        imageKeywords: [a.title.split(" ")[0], a.title.split(" ")[1] || "car"],
        isFeaturedCandidate: relevanceScore >= 8,
      };
    });
  }

  // Merge scores back with original articles
  const articlesWithScores = allArticles.map((article) => {
    const score = scoredArticles.find((s) => s.title === article.title) || {
      category: "Highlights",
      relevanceScore: 5,
      interestScore: 5,
      imageKeywords: ["automotive"],
      isFeaturedCandidate: false,
    };

    return {
      ...article,
      ...score,
    };
  });

  return articlesWithScores;
}

// ============================================================================
// STAGE 2: SELECT LINEUP
// ============================================================================

async function selectLineup(scoredArticles) {
  log("📋", "Selecting newsletter lineup...");

  // Featured story: top candidate by combined score
  const featured = scoredArticles
    .filter((a) => a.isFeaturedCandidate || a.relevanceScore >= 8)
    .sort((a, b) => b.relevanceScore + b.interestScore - (a.relevanceScore + a.interestScore))[0];

  // Highlights: next 5 best
  const highlights = scoredArticles
    .filter((a) => a !== featured)
    .sort((a, b) => b.interestScore - a.interestScore)
    .slice(0, 5);

  // Group remaining by category
  const remaining = scoredArticles.filter(
    (a) => a !== featured && !highlights.includes(a)
  );

  const byCategory = {};
  for (const article of remaining) {
    const cat = article.category || "Highlights";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(article);
  }

  // Sort each category by interest
  for (const cat in byCategory) {
    byCategory[cat].sort((a, b) => b.interestScore - a.interestScore);
  }

  // Quick hits: random selection from remaining
  const quickHits = remaining
    .slice(0, 3)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const lineup = {
    featured,
    highlights,
    byCategory,
    quickHits,
    totalArticles: scoredArticles.length,
  };

  log("✅", `Lineup selected: 1 featured, ${highlights.length} highlights, ${quickHits.length} quick hits`);

  return lineup;
}

// ============================================================================
// STAGE 3: WRITE COPY
// ============================================================================

async function writeCopy(lineup) {
  log("✍️", "Writing newsletter copy...");

  const client = new Anthropic();

  const formatArticle = (a) =>
    `Title: ${a.title}\nSource: ${a.source}\nCategory: ${a.category}\nSummary: ${a.description.substring(0, 500)}`;

  const promptText = `You are writing for "The Daily Redline" - a premium daily automotive newsletter for enthusiasts.

TONE: Smart, concise, slightly punchy, zero fluff. Like a knowledgeable car guy who doesn't BS. No corporate language.

STYLE RULES for summaries:
- 2-3 sentences max
- First sentence: what happened
- Second: why it matters for car guys
- Third: specific detail or number

Write compelling, authentic copy. Avoid these banned phrases at all costs:
${BANNED_PHRASES.map((p) => `- "${p}"`).join("\n")}

FEATURED STORY (anchor):
${formatArticle(lineup.featured)}

HIGHLIGHTS (next 5 best):
${lineup.highlights.map((a, i) => `${i + 1}. ${formatArticle(a)}`).join("\n\n")}

QUICK HITS (short updates):
${lineup.quickHits.map((a) => `- ${a.title}`).join("\n")}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "intro": "2-3 sentence opener that feels natural and sets tone",
  "featured": {
    "headline": "punchy headline for featured story",
    "summary": "2-3 sentence summary following the style rules"
  },
  "highlights": [
    {
      "headline": "headline",
      "summary": "2-3 sentence summary"
    }
  ],
  "byCategory": {
    "Electric & Tech": [
      {
        "headline": "headline",
        "summary": "summary",
        "source": "Source Name"
      }
    ]
  },
  "quickHits": [
    "one-liner with impact"
  ],
  "carInsightOfTheDay": "clever, interesting 1-2 sentence insight about cars/driving culture"
}`;

  const message = await client.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: promptText,
      },
    ],
  });

  let copy = null;
  try {
    const content = message.content[0].text;
    const cleanJson = content.replace(/```json|```/g, "").trim();
    copy = JSON.parse(cleanJson);
  } catch (err) {
    log("⚠️", `Failed to parse copy response: ${err.message}`);
    throw new Error("Failed to generate newsletter copy");
  }

  // Validate copy
  if (
    !copy.intro ||
    !copy.featured ||
    !Array.isArray(copy.highlights) ||
    !copy.quickHits
  ) {
    throw new Error("Generated copy missing required fields");
  }

  log("✅", "Newsletter copy generated");

  return {
    copy,
    lineup,
  };
}

// ============================================================================
// STAGE 4: HTML GENERATION (Pure JS)
// ============================================================================

function generateHTML(data) {
  const { copy, lineup } = data;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const categoryMap = {
    "New Releases": "#FF6B35",
    "Electric & Tech": "#00D9FF",
    "Motorsports & Racing": "#FF1744",
    "Builds & Modifications": "#FF9800",
    "Recalls & Reliability": "#FFC107",
    "Business & Industry": "#673AB7",
    Industry: "#673AB7",
    "Industry & Business": "#673AB7",
    Highlights: "#1976D2",
  };

  const getColor = (category) => categoryMap[category] || "#333";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Daily Redline - ${today}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #f5f5f5;
        }
        table {
            border-collapse: collapse;
        }
        img {
            display: block;
            max-width: 100%;
            height: auto;
        }
        a {
            color: #FF6B35;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">

<!-- CONTAINER -->
<table role="presentation" style="width: 100%; max-width: 640px; margin: 0 auto; background-color: #ffffff;">
<tbody>

<!-- HEADER -->
<tr>
    <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 40px 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 32px; font-weight: 700; color: #FF6B35; letter-spacing: 2px;">
            THE DAILY REDLINE
        </h1>
        <p style="margin: 8px 0 0 0; font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 1px;">
            ${today}
        </p>
    </td>
</tr>

<!-- INTRO -->
<tr>
    <td style="padding: 30px 20px; background-color: #fff;">
        <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #333;">
            ${sanitizeHtml(copy.intro)}
        </p>
    </td>
</tr>

<!-- DIVIDER -->
<tr>
    <td style="padding: 0; height: 2px; background-color: #FF6B35;"></td>
</tr>

<!-- FEATURED STORY -->
<tr>
    <td style="padding: 30px 20px;">
        <div style="border: 2px solid #FF6B35; padding: 20px; background-color: #fafafa;">
            <p style="margin: 0 0 10px 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #FF6B35;">
                ⭐ Featured Story
            </p>
            <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; line-height: 1.4; color: #1a1a1a;">
                ${sanitizeHtml(copy.featured.headline)}
            </h2>
            <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #555;">
                ${sanitizeHtml(copy.featured.summary)}
            </p>
            <p style="margin: 15px 0 0 0;">
                <a href="${sanitizeHtml(lineup.featured.link)}" style="display: inline-block; padding: 8px 16px; background-color: #FF6B35; color: white; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                    Read Full Story →
                </a>
            </p>
        </div>
    </td>
</tr>

<!-- HIGHLIGHTS -->
<tr>
    <td style="padding: 30px 20px;">
        <h3 style="margin: 0 0 20px 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1a1a1a; border-bottom: 2px solid #FF6B35; padding-bottom: 10px;">
            Today's Highlights
        </h3>
        ${copy.highlights
          .map(
            (h, i) => `
        <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #e0e0e0;">
            <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; color: #FF6B35; text-transform: uppercase; letter-spacing: 0.5px;">
                ${String.fromCharCode(9312 + i)} Highlight
            </p>
            <h4 style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600; color: #1a1a1a; line-height: 1.4;">
                ${sanitizeHtml(h.headline)}
            </h4>
            <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #666;">
                ${sanitizeHtml(h.summary)}
            </p>
        </div>
        `
          )
          .join("")}
    </td>
</tr>

${
  Object.keys(copy.byCategory || {})
    .slice(0, 4)
    .map((cat) => {
      const articles = copy.byCategory[cat] || [];
      if (articles.length === 0) return "";

      const color = getColor(cat);

      return `
<!-- CATEGORY: ${cat} -->
<tr>
    <td style="padding: 30px 20px; background-color: #f9f9f9;">
        <h3 style="margin: 0 0 15px 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1a1a1a; border-left: 4px solid ${color}; padding-left: 12px;">
            ${cat}
        </h3>
        ${articles
          .slice(0, 3)
          .map(
            (a) => `
        <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e8e8e8;">
            <h4 style="margin: 0 0 5px 0; font-size: 14px; font-weight: 600; color: #1a1a1a;">
                ${sanitizeHtml(a.headline)}
            </h4>
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #999; font-style: italic;">
                via ${sanitizeHtml(a.source || "Unknown")}
            </p>
            <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #666;">
                ${sanitizeHtml(a.summary)}
            </p>
        </div>
        `
          )
          .join("")}
    </td>
</tr>
      `;
    })
    .join("")
}

<!-- QUICK HITS -->
<tr>
    <td style="padding: 30px 20px;">
        <h3 style="margin: 0 0 15px 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1a1a1a; border-bottom: 2px solid #FF6B35; padding-bottom: 10px;">
            ⚡ Quick Hits
        </h3>
        <ul style="margin: 0; padding: 0; list-style: none;">
            ${copy.quickHits
              .slice(0, 5)
              .map(
                (hit) => `
            <li style="margin-bottom: 10px; padding-left: 20px; position: relative; font-size: 13px; line-height: 1.5; color: #555;">
                <span style="position: absolute; left: 0; color: #FF6B35; font-weight: bold;">•</span>
                ${sanitizeHtml(hit)}
            </li>
            `
              )
              .join("")}
        </ul>
    </td>
</tr>

<!-- INSIGHT OF THE DAY -->
<tr>
    <td style="padding: 30px 20px; background-color: #f0f7ff; border-left: 4px solid #1976D2;">
        <p style="margin: 0 0 8px 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1976D2;">
            🧠 Car Insight of the Day
        </p>
        <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #1a1a1a; font-style: italic;">
            "${sanitizeHtml(copy.carInsightOfTheDay)}"
        </p>
    </td>
</tr>

<!-- FOOTER -->
<tr>
    <td style="padding: 30px 20px; background-color: #1a1a1a; text-align: center; font-size: 12px; color: #888;">
        <p style="margin: 0 0 10px 0;">
            <strong style="color: #FF6B35;">The Daily Redline</strong> — Your daily automotive intelligence
        </p>
        <p style="margin: 0; color: #666; font-size: 11px;">
            © ${new Date().getFullYear()} The Daily Redline. All rights reserved.<br>
            You're receiving this because you love cars.
        </p>
    </td>
</tr>

</tbody>
</table>

</body>
</html>`;

  return html;
}

// ============================================================================
// SEND EMAIL
// ============================================================================

async function sendNewsletter(html) {
  if (process.env.DRY_RUN === "true") {
    log("📧", "DRY RUN: Skipping email send");
    log("📧", "HTML preview saved to /tmp/daily-redline-preview.html");
    fs.writeFileSync("/tmp/daily-redline-preview.html", html);
    return;
  }

  log("📧", "Sending newsletter...");

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const msg = {
    to: process.env.TO_EMAIL,
    from: process.env.FROM_EMAIL,
    subject: `The Daily Redline - ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    html: html,
    categories: ["daily-redline"],
  };

  try {
    await sgMail.send(msg);
    log("✅", `Newsletter sent to ${process.env.TO_EMAIL}`);
  } catch (err) {
    log("❌", `Failed to send newsletter: ${err.message}`);
    throw err;
  }
}

// ============================================================================
// MAIN ORCHESTRATION
// ============================================================================

async function main() {
  try {
    log("🚀", "Starting The Daily Redline...");

    validateEnv();

    // Stage 1: Fetch and score
    const scoredArticles = await fetchAndScoreArticles();

    if (scoredArticles.length === 0) {
      log("⚠️", "No articles found. Exiting.");
      process.exit(0);
    }

    // Stage 2: Select lineup
    const lineup = await selectLineup(scoredArticles);

    // Stage 3: Write copy
    const content = await writeCopy(lineup);

    // Stage 4: Generate HTML
    const html = generateHTML(content);

    // Send
    await sendNewsletter(html);

    log("✅", "The Daily Redline complete!");
  } catch (err) {
    log("❌", `Fatal error: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
