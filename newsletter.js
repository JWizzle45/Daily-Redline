#!/usr/bin/env node

/**
 * THE DAILY DIVE — Automated Newsletter
 * ======================================
 * Multi-stage Claude pipeline:
 *   Stage 1: Fetch + categorize + score articles
 *   Stage 2: Select featured story, highlights, lineup
 *   Stage 3: Write newsletter copy (summaries, intro, fact, etc.)
 *   Stage 4: Generate full HTML email (pure JS — no extra Claude call)
 *
 * Run:          node newsletter.js
 * Dry run:      DRY_RUN=true node newsletter.js
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
// RSS FEEDS
// Add, remove, or replace feeds here.
// ─────────────────────────────────────────────

const RSS_FEEDS = [
  "https://divernet.com/feed/",            // Divernet — scuba news
  "https://www.deeperblue.com/feed/",      // DeeperBlue — freediving + scuba
  "https://blog.padi.com/feed/",           // PADI — industry + training
  "https://www.scubadiving.com/rss.xml",   // Scuba Diving magazine
  // "https://alertdiver.eu/en/feed/",     // DAN Alert Diver — safety
  // "https://oceana.org/feed/",           // Oceana — conservation
];

// ─────────────────────────────────────────────
// FALLBACK IMAGES (Unsplash — free, no key needed)
// Used when an article has no image or a low relevance score.
// ─────────────────────────────────────────────

const FALLBACK_IMAGES = {
  "Freediving & Skills"        : "https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=600&auto=format&fit=crop&q=80",
  "Expeditions & Conservation" : "https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=600&auto=format&fit=crop&q=80",
  "Marine Life"                : "https://images.unsplash.com/photo-1682687221006-b7fd60cf9dd0?w=600&auto=format&fit=crop&q=80",
  "Gear & Tech"                : "https://images.unsplash.com/photo-1588495493282-f3a69eb2eb4b?w=600&auto=format&fit=crop&q=80",
  "Industry & Leadership"      : "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&auto=format&fit=crop&q=80",
  "Quick Hits"                 : "https://images.unsplash.com/photo-1559827291-72ee739d0d9a?w=600&auto=format&fit=crop&q=80",
  default                      : "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&auto=format&fit=crop&q=80",
};

// ─────────────────────────────────────────────
// DESIGN TOKENS
// Change colors here to restyle the newsletter.
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function getDisplayDate() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function getYear() { return new Date().getFullYear(); }

/** Strip markdown code fences that Claude sometimes wraps JSON in */
function parseJSON(raw) {
  const clean = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  return JSON.parse(clean);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─────────────────────────────────────────────
// IMAGE SCORING
// ─────────────────────────────────────────────

const IMG_HIGH = ["scuba","diver","diving","underwater","reef","coral","freediv",
  "rebreather","wetsuit","regulator","buoyancy","decompression","manta","wreck"];
const IMG_MED  = ["ocean","marine","sea","boat","vessel","snorkel","kelp","depth",
  "conservation","expedition","exploration","shark","turtle","whale"];
const IMG_LOW  = ["water","coast","beach","island","tropical","fish","research","wave"];

function scoreArticleImage(article) {
  const text = `${article.title} ${article.contentSnippet}`.toLowerCase();
  let s = 0;
  IMG_HIGH.forEach((k) => { if (text.includes(k)) s += 3; });
  IMG_MED.forEach((k)  => { if (text.includes(k)) s += 2; });
  IMG_LOW.forEach((k)  => { if (text.includes(k)) s += 1; });
  return Math.min(s, 10);
}

function resolveImage(article, category, usedImages) {
  if (article.image && scoreArticleImage(article) >= 3 && !usedImages.has(article.image)) {
    usedImages.add(article.image);
    return article.image;
  }
  const fallback = FALLBACK_IMAGES[category] || FALLBACK_IMAGES.default;
  if (!usedImages.has(fallback)) {
    usedImages.add(fallback);
    return fallback;
  }
  return FALLBACK_IMAGES.default;
}

// ─────────────────────────────────────────────
// RSS FETCHING
// ─────────────────────────────────────────────

async function fetchFeed(url) {
  const parser = new Parser({
    timeout: 10000,
    customFields: { item: [["media:content","media:content"],["enclosure","enclosure"]] },
  });
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map((item) => ({
      title:          (item.title || "").trim(),
      link:           item.link || item.guid || "",
      contentSnippet: (item.contentSnippet || item.content || "").slice(0, 500),
      pubDate:        item.pubDate || "",
      source:         feed.title || url,
      image:          item["media:content"]?.["$"]?.url || item.enclosure?.url || null,
    }));
  } catch (err) {
    log(`Warning: failed to fetch ${url}: ${err.message}`);
    return [];
  }
}

function deduplicateArticles(articles) {
  const seenLinks  = new Set();
  const seenTitles = new Set();
  return articles.filter(({ link, title }) => {
    const norm = title.toLowerCase().slice(0, 60);
    if (seenLinks.has(link) || seenTitles.has(norm)) return false;
    seenLinks.add(link);
    seenTitles.add(norm);
    return true;
  });
}

function filterDivingArticles(articles) {
  const kw = ["scuba","diving","underwater","reef","ocean","dive","freediving",
    "rebreather","wreck","marine","snorkel","diver","manta","coral","conservation"];
  return articles.filter(({ title, contentSnippet }) =>
    kw.some((k) => `${title} ${contentSnippet}`.toLowerCase().includes(k))
  );
}

// ─────────────────────────────────────────────
// CLAUDE WRAPPER
// ─────────────────────────────────────────────

async function callClaude(anthropic, prompt, label) {
  log(`Claude: ${label}...`);
  const res = await anthropic.messages.create({
    model: CONFIG.MODEL, max_tokens: CONFIG.MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content.map((b) => b.text || "").join("");
}

// ─────────────────────────────────────────────
// STAGE 1 — CATEGORIZE + SCORE
// ─────────────────────────────────────────────

async function stage1_categorize(anthropic, articles) {
  const list = articles
    .slice(0, CONFIG.MAX_ARTICLES)
    .map((a, i) =>
      `[${i + 1}] Title: ${a.title}\nSource: ${a.source}\nSnippet: ${a.contentSnippet.slice(0, 200)}`
    )
    .join("\n\n");

  const prompt = `
You are the editorial director of The Daily Dive, a premium scuba and ocean newsletter.

Score and categorize each article. Return ONLY a valid JSON array. No markdown, no explanation.

Each object:
- "index": number (1-based)
- "title": string
- "source": string
- "category": one of ["Freediving & Skills","Expeditions & Conservation","Marine Life","Gear & Tech","Industry & Leadership","Quick Hits"]
- "relevanceScore": 1-10 (how diving/ocean-relevant)
- "noveltyScore": 1-10 (how surprising or new)
- "readerInterestScore": 1-10 (would a diver care today)
- "imageKeywords": array of 3-5 strings (ideal image description for this story)
- "suggestedAngle": string (one sentence — best reader angle)
- "isFeaturedCandidate": boolean (true = strong hero story candidate)

CATEGORY GUIDE:
- Freediving & Skills: breath-hold, technique, training, performance
- Expeditions & Conservation: reef surveys, ocean research, environmental projects
- Marine Life: wildlife, species, biology, behavior
- Gear & Tech: equipment, products, cameras, dive computers, technology
- Industry & Leadership: PADI/SSI/agencies, certifications, business, policy, people
- Quick Hits: minor news, brief updates, anything that doesn't fit above

ARTICLES:
${list}`;

  const raw = await callClaude(anthropic, prompt, "Stage 1 — Categorize");

  let scored;
  try {
    scored = parseJSON(raw);
  } catch (err) {
    log(`Stage 1 JSON parse failed: ${err.message} — using basic fallback`);
    scored = articles.slice(0, CONFIG.MAX_ARTICLES).map((a, i) => ({
      index: i + 1, title: a.title, source: a.source,
      category: "Industry & Leadership",
      relevanceScore: 5, noveltyScore: 5, readerInterestScore: 5,
      imageKeywords: ["scuba diver","underwater ocean"],
      suggestedAngle: a.title,
      isFeaturedCandidate: i === 0,
    }));
  }

  // Merge back original article data (link, image, snippet)
  return scored.map((s) => {
    const orig = articles[s.index - 1] || {};
    return { ...s, link: orig.link || "", image: orig.image || null, contentSnippet: orig.contentSnippet || "" };
  });
}

// ─────────────────────────────────────────────
// STAGE 2 — SELECT LINEUP
// ─────────────────────────────────────────────

async function stage2_selectLineup(anthropic, scored) {
  const list = scored.map((a) =>
    `[${a.index}] ${a.title} | ${a.category} | R:${a.relevanceScore} N:${a.noveltyScore} I:${a.readerInterestScore} | Featured:${a.isFeaturedCandidate}`
  ).join("\n");

  const prompt = `
You are the managing editor of The Daily Dive newsletter.

Build today's newsletter lineup from the scored articles below.
Return ONLY valid JSON. No markdown, no explanation.

JSON shape:
{
  "featuredIndex": number,
  "highlightIndices": [4-6 numbers],
  "sections": {
    "Section Name": [array of article index numbers, 1-3 each]
  },
  "quickHitIndices": [3-5 numbers],
  "engagementModule": "Gear Drop" | "Ocean Tech Spotlight" | "none"
}

RULES:
- featuredIndex: most dramatic + visually strong story. Must be scuba/ocean-specific.
- highlightIndices: diverse categories, high interest, include featured if relevant.
- sections: include only sections with good content. Omit empty sections.
- quickHitIndices: brief items, minor news. No overlap with sections.
- engagementModule: "Gear Drop" if strong gear launch exists, "Ocean Tech Spotlight" if strong tech story exists, else "none".

SCORED ARTICLES:
${list}`;

  const raw = await callClaude(anthropic, prompt, "Stage 2 — Lineup");
  try {
    return parseJSON(raw);
  } catch (err) {
    log(`Stage 2 JSON parse failed: ${err.message} — using fallback lineup`);
    const top = [...scored].sort((a, b) => b.readerInterestScore - a.readerInterestScore);
    return {
      featuredIndex:    top[0]?.index || 1,
      highlightIndices: top.slice(0, 4).map((a) => a.index),
      sections:         {},
      quickHitIndices:  top.slice(4, 7).map((a) => a.index),
      engagementModule: "none",
    };
  }
}

// ─────────────────────────────────────────────
// STAGE 3 — WRITE COPY
// ─────────────────────────────────────────────

async function stage3_writeCopy(anthropic, scored, lineup, displayDate) {
  const byIdx = Object.fromEntries(scored.map((a) => [a.index, a]));

  const featured   = byIdx[lineup.featuredIndex];
  const highlights = (lineup.highlightIndices || []).map((i) => byIdx[i]).filter(Boolean);
  const qh         = (lineup.quickHitIndices  || []).map((i) => byIdx[i]).filter(Boolean);
  const sectionArts = {};
  for (const [sec, idxs] of Object.entries(lineup.sections || {})) {
    sectionArts[sec] = idxs.map((i) => byIdx[i]).filter(Boolean);
  }

  const allArts = [featured, ...highlights, ...Object.values(sectionArts).flat(), ...qh]
    .filter(Boolean)
    .filter((a, i, self) => self.findIndex((b) => b.index === a.index) === i);

  const articleDetail = allArts.map((a) =>
    `[${a.index}] "${a.title}" — ${a.source}\nAngle: ${a.suggestedAngle}\nSnippet: ${a.contentSnippet?.slice(0, 280)}`
  ).join("\n\n");

  const prompt = `
You are the lead writer for The Daily Dive, a premium daily scuba and ocean newsletter.
Today: ${displayDate}

Write newsletter copy. Return ONLY valid JSON. No markdown, no extra text.

STYLE RULES:
- 2-3 sentence summaries. Sentence 1: the news. Sentence 2: why a diver cares. Sentence 3: one specific fact or stat.
- Active voice. Vary sentence length. Specific > vague. Numbers anchor copy.
- Occasional dry wit welcome. Forced enthusiasm is not.
- DO NOT start consecutive summaries with the same word.

BANNED PHRASES (never use):
groundbreaking, critical importance, raises awareness, showcases, push boundaries,
fascinating world of, nestled beneath the waves, embark on a journey, underscores,
delve into, highlights the need, significant impact, innovative solution, cutting-edge,
in today's fast-paced world, it is worth noting, furthermore, a reminder that,
game-changing, revolutionary, has been making waves, shines a spotlight

RETURN exactly this JSON:
{
  "intro": "3-4 sentence intro. Name 3 real stories. End with a punchy call to read.",
  "featuredHeadline": "Rewritten headline for article ${featured?.index} — specific, under 65 chars, title case",
  "featuredSummary": "4 sentences. Engaging, specific, human. No fluff.",
  "featuredCTA": "Short CTA text e.g. 'Read Full Story →' or 'See What Happened →'",
  "highlights": [
    { "index": N, "boldLine": "hook under 8 words", "whyCareLine": "one sentence why divers care" }
  ],
  "sections": {
    "SECTION NAME": [
      { "index": N, "headline": "rewritten specific headline", "summary": "2-3 sentence summary" }
    ]
  },
  "quickHits": [
    { "index": N, "line": "one punchy sentence with source at end" }
  ],
  "diveFact": "One surprising, verifiable ocean/diving fact. 1-2 sentences. Do not open with 'Did you know'. Make it shareable.",
  "engagementModule": {
    "type": "${lineup.engagementModule}",
    "headline": "short module headline",
    "body": "2-3 sentence spotlight. Leave blank if type is none."
  }
}

ARTICLES:
${articleDetail}`;

  const raw = await callClaude(anthropic, prompt, "Stage 3 — Copy");
  try {
    return parseJSON(raw);
  } catch (err) {
    log(`Stage 3 JSON parse failed: ${err.message} — using fallback copy`);
    return {
      intro: `Welcome to The Daily Dive for ${displayDate}. Here's what's happening beneath the surface.`,
      featuredHeadline: featured?.title || "Today's Top Story",
      featuredSummary:  featured?.contentSnippet?.slice(0, 300) || "",
      featuredCTA:      "Read Full Story →",
      highlights:       highlights.map((a) => ({ index: a.index, boldLine: a.title.slice(0, 50), whyCareLine: a.suggestedAngle })),
      sections:         Object.fromEntries(Object.entries(sectionArts).map(([s, arts]) => [s, arts.map((a) => ({ index: a.index, headline: a.title, summary: a.contentSnippet?.slice(0, 200) || "" }))])),
      quickHits:        qh.map((a) => ({ index: a.index, line: `${a.title} — ${a.source}` })),
      diveFact:         "The ocean covers 71% of Earth's surface, yet 80% of it remains unexplored.",
      engagementModule: { type: "none", headline: "", body: "" },
    };
  }
}

// ─────────────────────────────────────────────
// STAGE 4 — BUILD HTML (pure JS, no Claude call)
// ─────────────────────────────────────────────

function buildHTML(copy, scored, lineup, displayDate) {
  const byIdx      = Object.fromEntries(scored.map((a) => [a.index, a]));
  const usedImages = new Set();
  const featured   = byIdx[lineup.featuredIndex];
  const heroImg    = resolveImage(featured || {}, featured?.category || "default", usedImages);

  // ── HTML helpers ──────────────────────────

  function sectionBar(label) {
    return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 10px;">
      <tr><td style="background:${D.tealDark};padding:10px 20px;border-radius:4px;">
        <p style="margin:0;color:#fff;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">${label}</p>
      </td></tr></table>`;
  }

  function ctaBtn(text, url) {
    return `<table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="center" style="padding:12px 0;">
        <a href="${url || '#'}" style="display:inline-block;background:${D.teal};color:#fff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:13px 26px;border-radius:6px;letter-spacing:0.3px;">${text}</a>
      </td></tr></table>`;
  }

  function storyCard(headline, summary, url, imgUrl, source, topStory) {
    return `<table width="100%" cellpadding="0" cellspacing="0" style="background:${D.cardBg};border-radius:8px;overflow:hidden;margin-bottom:14px;">
      ${imgUrl ? `<tr><td><img src="${imgUrl}" alt="${(headline || "").replace(/"/g, "'")}" width="600" style="width:100%;max-width:600px;height:200px;object-fit:cover;display:block;" /></td></tr>` : ""}
      <tr><td style="padding:18px 20px 6px;">
        ${topStory ? `<p style="margin:0 0 8px;display:inline-block;background:${D.tealLight};color:${D.teal};font-size:11px;font-weight:bold;padding:3px 9px;border-radius:12px;text-transform:uppercase;">TOP STORY</p>` : ""}
        <h2 style="margin:6px 0 10px;font-size:19px;font-weight:bold;color:${D.text};line-height:1.35;font-family:Arial,sans-serif;">${headline}</h2>
        <p style="margin:0;font-size:15px;color:#374151;line-height:1.7;font-family:Arial,sans-serif;">${summary}</p>
      </td></tr>
      <tr><td style="padding:6px 20px 16px;">
        ${ctaBtn("Read Full Story →", url)}
        <p style="margin:0;font-size:11px;color:${D.muted};font-family:Arial,sans-serif;">Source: ${source || ""}</p>
      </td></tr>
    </table>`;
  }

  // ── Featured hero ─────────────────────────

  const featuredHTML = featured ? `
    ${sectionBar("🌟 Featured Story")}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;background:${D.navy};margin-bottom:16px;">
      <tr><td><img src="${heroImg}" alt="${(copy.featuredHeadline || "").replace(/"/g, "'")}" width="600" style="width:100%;max-width:600px;height:260px;object-fit:cover;display:block;opacity:0.85;" /></td></tr>
      <tr><td style="padding:22px 24px 18px;">
        <p style="margin:0 0 8px;display:inline-block;background:${D.teal};color:#fff;font-size:11px;font-weight:bold;padding:3px 10px;border-radius:12px;text-transform:uppercase;font-family:Arial,sans-serif;">FEATURED</p>
        <h2 style="margin:8px 0 12px;font-size:22px;font-weight:bold;color:#fff;line-height:1.3;font-family:Arial,sans-serif;">${copy.featuredHeadline || ""}</h2>
        <p style="margin:0 0 16px;font-size:15px;color:#c8dff0;line-height:1.7;font-family:Arial,sans-serif;">${copy.featuredSummary || ""}</p>
        ${ctaBtn(copy.featuredCTA || "Read Full Story →", featured.link || "#")}
        <p style="margin:4px 0 0;font-size:11px;color:#7aa5c2;font-family:Arial,sans-serif;">Source: ${featured.source || ""}</p>
      </td></tr>
    </table>` : "";

  // ── Section blocks ────────────────────────

  const sectionHTML = Object.entries(copy.sections || {}).map(([name, arts]) => {
    if (!arts || arts.length === 0) return "";
    const cards = arts.map((a, idx) => {
      const orig = byIdx[a.index] || {};
      const img  = idx === 0 ? resolveImage(orig, name, usedImages) : null;
      return storyCard(a.headline, a.summary, orig.link || "#", img, orig.source || "", false);
    }).join("");
    return sectionBar(name) + cards;
  }).join("");

  // ── Highlights ────────────────────────────

  const highlightRows = (copy.highlights || []).map((h) =>
    `<tr><td style="padding:5px 0;border-bottom:0.5px solid #d4eaf5;">
      <p style="margin:0;font-size:14px;color:${D.text};line-height:1.6;font-family:Arial,sans-serif;">
        <strong>${h.boldLine}</strong> — ${h.whyCareLine}
      </p></td></tr>`
  ).join("");

  // ── Quick hits ────────────────────────────

  const qhRows = (copy.quickHits || []).map((q) =>
    `<tr><td style="padding:5px 0;border-bottom:0.5px solid #e5eef5;">
      <p style="margin:0;font-size:14px;color:${D.text};line-height:1.6;font-family:Arial,sans-serif;">▸ ${q.line}</p>
     </td></tr>`
  ).join("");

  const quickHitsHTML = qhRows ? `
    ${sectionBar("⚡ Quick Hits")}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${D.cardBg};border-radius:8px;padding:16px 20px;margin-bottom:14px;">
      ${qhRows}
    </table>` : "";

  // ── Engagement module ─────────────────────

  const em = copy.engagementModule || {};
  const emHTML = em.type !== "none" && em.body ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#e8f4fd;border-left:4px solid ${D.teal};border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:16px;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:11px;font-weight:bold;color:${D.teal};text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;">${em.type}</p>
        <h3 style="margin:0 0 8px;font-size:17px;font-weight:bold;color:${D.text};font-family:Arial,sans-serif;">${em.headline || ""}</h3>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;font-family:Arial,sans-serif;">${em.body}</p>
      </td></tr>
    </table>` : "";

  // ── Dive Fact ─────────────────────────────

  const factHTML = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${D.factBg};border:1.5px solid ${D.factBorder};border-radius:8px;padding:18px 22px;margin-bottom:16px;">
      <tr><td>
        <p style="margin:0 0 6px;font-size:12px;font-weight:bold;color:#92700a;text-transform:uppercase;letter-spacing:1.5px;font-family:Arial,sans-serif;">🌊 Dive Fact of the Day</p>
        <p style="margin:0;font-size:15px;color:${D.text};line-height:1.7;font-style:italic;font-family:Arial,sans-serif;">${copy.diveFact || ""}</p>
      </td></tr>
    </table>`;

  // ── Full document ─────────────────────────

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>The Daily Dive — ${displayDate}</title>
<style>
@media only screen and (max-width:640px){
  .eb{width:100%!important;}
  .hi{height:180px!important;}
  .ht{font-size:17px!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${D.bg};font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${D.bg};">
<tr><td align="center">
<table class="eb" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:${D.bg};">

  <!-- HEADER -->
  <tr><td style="background:${D.navy};padding:36px 28px 28px;text-align:center;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 6px;font-size:12px;color:#7ec8e3;text-transform:uppercase;letter-spacing:3px;font-family:Arial,sans-serif;">Your Daily Ocean Briefing</p>
    <h1 style="margin:0 0 8px;font-size:38px;font-weight:900;color:#fff;font-family:Arial,sans-serif;letter-spacing:2px;">🤿 The Daily Dive</h1>
    <p style="margin:0;font-size:13px;color:#9bcfe0;font-family:Arial,sans-serif;">${displayDate}</p>
    <p style="margin:14px auto 0;width:60px;border-top:2px solid rgba(255,255,255,0.25);"></p>
  </td></tr>

  <!-- INTRO -->
  <tr><td style="padding:24px 24px 8px;">
    <p style="margin:0;font-size:16px;color:${D.text};line-height:1.85;font-family:Georgia,'Times New Roman',serif;">${copy.intro || ""}</p>
  </td></tr>

  <!-- TODAY'S HIGHLIGHTS -->
  <tr><td style="padding:16px 24px 8px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${D.tealLight};border-left:4px solid ${D.teal};border-radius:0 8px 8px 0;padding:16px 20px;">
      <tr><td>
        <p style="margin:0 0 10px;font-size:12px;font-weight:bold;color:${D.teal};text-transform:uppercase;letter-spacing:1.5px;font-family:Arial,sans-serif;">📋 Today's Highlights</p>
        <table width="100%" cellpadding="0" cellspacing="0">${highlightRows}</table>
      </td></tr>
    </table>
  </td></tr>

  <!-- FEATURED STORY -->
  <tr><td style="padding:8px 24px 0;">${featuredHTML}</td></tr>

  <!-- SECTIONS -->
  <tr><td style="padding:0 24px;">${sectionHTML}</td></tr>

  <!-- DIVE FACT -->
  <tr><td style="padding:0 24px;">${factHTML}</td></tr>

  <!-- ENGAGEMENT MODULE -->
  <tr><td style="padding:0 24px;">${emHTML}</td></tr>

  <!-- QUICK HITS -->
  <tr><td style="padding:0 24px 8px;">${quickHitsHTML}</td></tr>

  <!-- FOOTER -->
  <tr><td style="background:${D.navy};padding:28px 24px;border-radius:12px 12px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding-bottom:12px;">
        <p style="margin:0;font-size:20px;font-weight:bold;color:#fff;font-family:Arial,sans-serif;letter-spacing:1px;">🤿 The Daily Dive</p>
        <p style="margin:4px 0 0;font-size:12px;color:#7ec8e3;font-family:Arial,sans-serif;">Your Daily Ocean Briefing</p>
      </td></tr>
      <tr><td style="border-top:0.5px solid rgba(255,255,255,0.15);padding-top:14px;">
        <p style="margin:0 0 6px;font-size:12px;color:#7aa5c2;text-align:center;font-family:Arial,sans-serif;line-height:1.8;">
          You're receiving this because you subscribed to The Daily Dive.<br />
          <a href="#" style="color:#7ec8e3;text-decoration:underline;">Unsubscribe</a> &nbsp;|&nbsp;
          <a href="#" style="color:#7ec8e3;text-decoration:underline;">Manage preferences</a>
        </p>
        <p style="margin:10px 0 0;font-size:11px;color:#4a6a82;text-align:center;font-family:Arial,sans-serif;">
          &copy; ${getYear()} The Daily Dive. All rights reserved.
        </p>
      </td></tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  log("─── The Daily Dive Newsletter ───────────────");
  const displayDate = getDisplayDate();

  // Fetch RSS
  log("Fetching RSS feeds...");
  const results = await Promise.all(RSS_FEEDS.map(fetchFeed));
  let articles   = deduplicateArticles(filterDivingArticles(results.flat()));
  log(`${articles.length} relevant articles after dedup + filter`);

  if (articles.length < 3) {
    log("Not enough articles to build a newsletter. Exiting.");
    process.exit(1);
  }

  if (CONFIG.DRY_RUN) {
    log(`DRY RUN: would process ${Math.min(articles.length, CONFIG.MAX_ARTICLES)} articles. No Claude calls, no email sent.`);
    log("Dry run complete.");
    return;
  }

  const anthropic = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });

  // Stage 1
  const scored = await stage1_categorize(anthropic, articles);
  log(`Stage 1 done — ${scored.length} articles scored`);
  await sleep(400);

  // Stage 2
  const lineup = await stage2_selectLineup(anthropic, scored);
  log(`Stage 2 done — featured: [${lineup.featuredIndex}]`);
  await sleep(400);

  // Stage 3
  const copy = await stage3_writeCopy(anthropic, scored, lineup, displayDate);
  log("Stage 3 done — copy written");
  await sleep(200);

  // Stage 4
  log("Building HTML...");
  const html = buildHTML(copy, scored, lineup, displayDate);
  log(`HTML ready — ${(html.length / 1024).toFixed(1)} KB`);

  // Send
  const subject = `🤿 The Daily Dive — ${displayDate}`;
  sgMail.setApiKey(CONFIG.SENDGRID_API_KEY);
  log(`Sending to ${CONFIG.TO_EMAIL}...`);
  await sgMail.send({
    to: CONFIG.TO_EMAIL, from: CONFIG.FROM_EMAIL, subject, html,
    text: `The Daily Dive — ${displayDate}\n\n${copy.intro || ""}\n\nRead the full edition online.`,
  });

  log("Newsletter sent successfully.");
  log("─────────────────────────────────────────────");
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
