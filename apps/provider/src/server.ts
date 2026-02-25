// ═══════════════════════════════════════════════════════════════
// NexusX — Provider Service
// apps/provider/src/server.ts
//
// Real upstream API provider for the NexusX marketplace.
// Serves working endpoints that the gateway proxies to.
// ═══════════════════════════════════════════════════════════════

import express from "express";
import type { Request, Response } from "express";
import crypto from "crypto";

export function createProviderApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // ─── Auth middleware (optional) ───
  const providerApiKey = process.env.PROVIDER_API_KEY;
  if (providerApiKey) {
    app.use((req, res, next) => {
      if (req.path === "/health") return next();
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${providerApiKey}`) {
        res.status(401).json({ error: "unauthorized", message: "Invalid or missing API key" });
        return;
      }
      next();
    });
  }

  // ─── Health check ───
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "nexusx-provider", timestamp: new Date().toISOString() });
  });

  // ─── POST /v3/embed — Text Embeddings ───
  app.post("/v3/embed", async (req: Request, res: Response) => {
    const { text, model } = req.body;
    if (!text) {
      res.status(400).json({ error: "missing_field", message: "text is required" });
      return;
    }

    await delay(30);

    const inputText = typeof text === "string" ? text : JSON.stringify(text);
    const embedding = generateEmbedding(inputText, 512);
    const tokens = Math.ceil(inputText.length / 4);

    res.json({
      object: "embedding",
      model: model || "text-embedding-v3",
      data: [{ object: "embedding", index: 0, embedding }],
      usage: { prompt_tokens: tokens, total_tokens: tokens },
    });
  });

  // ─── POST /v1/sentiment — Sentiment Analysis ───
  app.post("/v1/sentiment", async (req: Request, res: Response) => {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: "missing_field", message: "text is required" });
      return;
    }

    await delay(40);

    const analysis = analyzeSentiment(text);
    res.json(analysis);
  });

  // ─── POST /v2/translate — Translation ───
  app.post("/v2/translate", async (req: Request, res: Response) => {
    const { text, target_lang, source_lang } = req.body;
    if (!text || !target_lang) {
      res.status(400).json({ error: "missing_field", message: "text and target_lang are required" });
      return;
    }

    await delay(50);

    const translated = translateText(text, target_lang);
    res.json({
      translations: [{
        detected_source_language: (source_lang || "EN").toUpperCase(),
        text: translated,
      }],
    });
  });

  // ─── POST /v1/chat/completions — LLM Chat ───
  app.post("/v1/chat/completions", async (req: Request, res: Response) => {
    const { messages, model } = req.body;
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "missing_field", message: "messages array is required" });
      return;
    }

    await delay(80);

    const lastMessage = messages[messages.length - 1];
    const userContent = lastMessage?.content || "";
    const responseText = generateChatResponse(userContent, model);
    const promptTokens = Math.ceil(JSON.stringify(messages).length / 4);
    const completionTokens = Math.ceil(responseText.length / 4);

    res.json({
      id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model || "nexusx-provider-v1",
      choices: [{
        index: 0,
        message: { role: "assistant", content: responseText },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
  });

  // ─── POST /v1/detect — Object Detection ───
  app.post("/v1/detect", async (req: Request, res: Response) => {
    const { image_url, image_base64 } = req.body;
    if (!image_url && !image_base64) {
      res.status(400).json({ error: "missing_field", message: "image_url or image_base64 is required" });
      return;
    }

    await delay(60);

    res.json({
      objects: [
        { label: "person", confidence: 0.97, bbox: [120, 80, 200, 400] },
        { label: "laptop", confidence: 0.93, bbox: [300, 200, 180, 120] },
        { label: "coffee_cup", confidence: 0.88, bbox: [500, 250, 60, 80] },
      ],
      scene: "indoor_office",
      image_width: 1920,
      image_height: 1080,
      model: "nexusx-vision-v1",
      processing_time_ms: 58,
    });
  });

  // ─── GET /v1/download/reviews — Restaurant Reviews Dataset ───
  app.get("/v1/download/reviews", async (_req: Request, res: Response) => {
    await delay(20);

    res.json({
      dataset: "restaurant-reviews-v1",
      total_reviews: 10,
      reviews: RESTAURANT_REVIEWS,
    });
  });

  // ─── 404 fallback ───
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found", message: "Endpoint not found" });
  });

  return app;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a deterministic embedding from text using a seeded hash. */
function generateEmbedding(text: string, dimensions: number): number[] {
  const hash = crypto.createHash("sha256").update(text).digest();
  const embedding: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    const byte1 = hash[(i * 2) % hash.length];
    const byte2 = hash[(i * 2 + 1) % hash.length];
    const raw = ((byte1 << 8) | byte2) / 65535;
    embedding.push(Math.round((raw * 2 - 1) * 1e6) / 1e6);
  }
  // Normalize to unit vector
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map((v) => Math.round((v / norm) * 1e6) / 1e6);
}

/** Simple rule-based sentiment analysis. */
function analyzeSentiment(text: string): {
  sentiment: string;
  confidence: number;
  polarity: number;
  subjectivity: number;
  keywords: string[];
} {
  const lower = text.toLowerCase();

  const positiveWords = [
    "good", "great", "excellent", "amazing", "wonderful", "fantastic", "love",
    "happy", "best", "perfect", "awesome", "beautiful", "brilliant", "outstanding",
    "nice", "enjoy", "pleasant", "superb", "delightful", "impressive",
  ];
  const negativeWords = [
    "bad", "terrible", "awful", "horrible", "hate", "worst", "poor",
    "ugly", "disgusting", "disappointing", "annoying", "boring", "dreadful",
    "mediocre", "pathetic", "useless", "broken", "fail", "sad", "angry",
  ];

  const words = lower.split(/\W+/).filter(Boolean);
  let posCount = 0;
  let negCount = 0;
  const keywords: string[] = [];

  for (const word of words) {
    if (positiveWords.includes(word)) { posCount++; keywords.push(`+${word}`); }
    if (negativeWords.includes(word)) { negCount++; keywords.push(`-${word}`); }
  }

  const total = posCount + negCount;
  const polarity = total === 0 ? 0 : (posCount - negCount) / total;
  const confidence = total === 0 ? 0.5 : Math.min(0.99, 0.6 + total * 0.08);
  const subjectivity = total === 0 ? 0.3 : Math.min(1.0, total / words.length * 3);

  let sentiment: string;
  if (polarity > 0.2) sentiment = "positive";
  else if (polarity < -0.2) sentiment = "negative";
  else sentiment = "neutral";

  return { sentiment, confidence: Math.round(confidence * 100) / 100, polarity: Math.round(polarity * 100) / 100, subjectivity: Math.round(subjectivity * 100) / 100, keywords };
}

/** Basic translation: wraps text with language tag and applies simple transforms. */
function translateText(text: string, targetLang: string): string {
  const lang = targetLang.toLowerCase();
  const transforms: Record<string, (t: string) => string> = {
    es: (t) => t.replace(/\bthe\b/gi, "el").replace(/\bis\b/gi, "es").replace(/\band\b/gi, "y").replace(/\bgood\b/gi, "bueno").replace(/\bhello\b/gi, "hola").replace(/\bworld\b/gi, "mundo"),
    fr: (t) => t.replace(/\bthe\b/gi, "le").replace(/\bis\b/gi, "est").replace(/\band\b/gi, "et").replace(/\bgood\b/gi, "bon").replace(/\bhello\b/gi, "bonjour").replace(/\bworld\b/gi, "monde"),
    de: (t) => t.replace(/\bthe\b/gi, "das").replace(/\bis\b/gi, "ist").replace(/\band\b/gi, "und").replace(/\bgood\b/gi, "gut").replace(/\bhello\b/gi, "hallo").replace(/\bworld\b/gi, "Welt"),
    ja: (t) => `[JA] ${t}`,
    zh: (t) => `[ZH] ${t}`,
  };
  const transform = transforms[lang];
  return transform ? transform(text) : `[${targetLang.toUpperCase()}] ${text}`;
}

/** Generate a structured chat response. */
function generateChatResponse(userContent: string, model?: string): string {
  const usedModel = model || "nexusx-provider-v1";
  if (!userContent.trim()) {
    return "I'm ready to help. What would you like to know?";
  }

  const lower = userContent.toLowerCase();
  if (lower.includes("hello") || lower.includes("hi ") || lower.startsWith("hi")) {
    return `Hello! I'm ${usedModel} running on NexusX. How can I help you today?`;
  }
  if (lower.includes("summarize") || lower.includes("summary")) {
    return `Here's a summary of the provided text:\n\nThe content discusses ${userContent.slice(0, 50).trim()}... Key points include the main topic and its implications. The text is approximately ${userContent.length} characters long.`;
  }
  if (lower.includes("explain") || lower.includes("what is")) {
    return `Great question! ${userContent.slice(0, 100).trim()}\n\nThis is a topic that involves multiple aspects. The key concepts are interconnected, and understanding them requires looking at both the fundamentals and practical applications.\n\n[Response generated by ${usedModel} on NexusX]`;
  }

  return `I've processed your request: "${userContent.slice(0, 100).trim()}${userContent.length > 100 ? "..." : ""}"\n\nBased on my analysis, here's my response:\n\nThe input contains ${userContent.split(/\s+/).length} words and covers topics related to ${userContent.split(/\s+/).slice(0, 3).join(", ")}. I've analyzed the content and can provide further details if needed.\n\n[Response generated by ${usedModel} on NexusX]`;
}

// ─────────────────────────────────────────────────────────────
// STATIC DATA
// ─────────────────────────────────────────────────────────────

const RESTAURANT_REVIEWS = [
  { id: 1, restaurant: "La Bella Italia", rating: 5, text: "Outstanding pasta carbonara. The chef clearly knows authentic Italian cuisine. Will return!", cuisine: "Italian" },
  { id: 2, restaurant: "Sakura Sushi Bar", rating: 4, text: "Fresh fish and creative rolls. The omakase was a highlight. Slightly overpriced.", cuisine: "Japanese" },
  { id: 3, restaurant: "Le Petit Bistro", rating: 3, text: "Decent French bistro food but nothing extraordinary. Service was slow on a busy night.", cuisine: "French" },
  { id: 4, restaurant: "Spice Route", rating: 5, text: "Best Indian food in the city! The tikka masala is perfectly spiced and the naan is freshly baked.", cuisine: "Indian" },
  { id: 5, restaurant: "Burger Republic", rating: 2, text: "Disappointing. Overcooked patty, soggy fries. The milkshake was the only saving grace.", cuisine: "American" },
  { id: 6, restaurant: "Green Garden", rating: 4, text: "Excellent vegan options. The mushroom risotto was creamy and flavorful. Great atmosphere.", cuisine: "Vegan" },
  { id: 7, restaurant: "Dragon Palace", rating: 4, text: "Authentic Sichuan cuisine with real heat. The mapo tofu was exceptional. Friendly staff.", cuisine: "Chinese" },
  { id: 8, restaurant: "Taco Loco", rating: 5, text: "Amazing street-style tacos! The al pastor is incredible and the salsa verde is homemade perfection.", cuisine: "Mexican" },
  { id: 9, restaurant: "The Rustic Table", rating: 3, text: "Farm-to-table concept is nice but execution is inconsistent. Some dishes shine, others fall flat.", cuisine: "American" },
  { id: 10, restaurant: "Pho Paradise", rating: 4, text: "Rich, aromatic broth that's been simmering for hours. The rare beef pho is a must-order.", cuisine: "Vietnamese" },
];
