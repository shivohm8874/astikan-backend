import type { FastifyPluginAsync } from "fastify";
import { XMLParser } from "fast-xml-parser";
import { cacheGet, cacheSet } from "../lab/lab.cache";
import { buildAiService } from "../ai/ai.service";

type RssItem = {
  title: string;
  link: string;
  pubDate?: string;
  source?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

const WHO_NEWS_RSS = "https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml";
const WHO_OUTBREAK_RSS = "https://www.who.int/feeds/entity/csr/don/en/rss.xml";

const buildGoogleNewsRss = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

function normalizeRss(xml: string): RssItem[] {
  try {
    const parsed = parser.parse(xml) as {
      rss?: { channel?: { item?: Array<Record<string, unknown>> | Record<string, unknown> } };
    };
    const rawItems = parsed.rss?.channel?.item;
    if (!rawItems) return [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    return items
      .map((item) => ({
        title: String(item.title ?? "").trim(),
        link: String(item.link ?? "").trim(),
        pubDate: typeof item.pubDate === "string" ? item.pubDate : undefined,
        source: typeof item.source === "string" ? item.source : undefined,
      }))
      .filter((item) => item.title && item.link);
  } catch {
    return [];
  }
}

function toRecent(items: RssItem[], days = 3) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    if (!item.pubDate) return true;
    const ts = Date.parse(item.pubDate);
    return Number.isNaN(ts) ? true : ts >= cutoff;
  });
}

function seedFromString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

function seededShuffle<T>(items: T[], seed: number) {
  const arr = [...items];
  let s = seed;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchRss(url: string): Promise<RssItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "AstikanHealthBot/1.0 (health tips; contact=ops@astikan.app)",
    },
  });
  if (!res.ok) return [];
  const text = await res.text();
  return normalizeRss(text);
}

async function reverseGeocode(lat: number, lon: number) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  const res = await fetch(url, {
    headers: {
      "User-Agent": "AstikanHealthBot/1.0 (reverse geocoding; contact=ops@astikan.app)",
    },
  });
  if (!res.ok) return "";
  const data = (await res.json()) as {
    address?: { city?: string; town?: string; village?: string; state?: string };
  };
  return data.address?.city || data.address?.town || data.address?.village || data.address?.state || "";
}

function fallbackTips(city: string) {
  return {
    city,
    topic: "Stay steady in changing conditions",
    tips: [
      {
        id: "daily-1",
        title: "Air quality mini-shield",
        summary: "Keep windows closed during traffic peaks and hydrate more on hazy days.",
        tags: ["Recovery", "Air"],
        moodTags: ["general", "stress"],
        heroImage:
          "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
        iconKey: "activity",
        sections: [
          {
            heading: "Cut exposure",
            body: "Shorter outdoor workouts and a scarf or mask can reduce irritation when air is poor.",
            coach: "Short breaths feel heavier in pollution—slow down and breathe through the nose.",
            question: {
              id: "q1",
              text: "How does the air feel right now?",
              options: ["Clear", "A bit heavy", "Very polluted"],
            },
          },
          {
            heading: "Hydration reset",
            body: "Warm water or herbal tea helps soothe the throat and keeps mucus thin.",
            coach: "Aim for 6-8 glasses today if the air feels dry or dusty.",
            question: {
              id: "q2",
              text: "Did you drink 2 glasses already?",
              options: ["Yes", "Not yet", "Just starting"],
            },
          },
          {
            heading: "Indoor movement",
            body: "Try 8-10 minutes of stretches indoors to keep circulation strong.",
            coach: "Gentle movement is better than skipping activity entirely.",
            question: {
              id: "q3",
              text: "Want a quick 8‑minute stretch?",
              options: ["Yes, show me", "Maybe later", "Not today"],
            },
          },
        ],
      },
      {
        id: "daily-2",
        title: "Heat smart plan",
        summary: "If it’s warm, keep salt + water balanced and avoid peak sun hours.",
        tags: ["Hydration"],
        moodTags: ["general", "fatigue"],
        heroImage:
          "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80",
        iconKey: "droplet",
        sections: [
          {
            heading: "Rehydrate wisely",
            body: "A pinch of salt or lemon water can help in high heat.",
            coach: "Small sips every 20 minutes beat large gulps.",
            question: {
              id: "q1",
              text: "Is the temperature high today?",
              options: ["Yes", "Moderate", "Not sure"],
            },
          },
          {
            heading: "Protect energy",
            body: "Plan heavy tasks for early morning or evening.",
            coach: "Your body performs best outside peak heat windows.",
            question: {
              id: "q2",
              text: "Can you move tasks to cooler hours?",
              options: ["Yes", "Some of them", "No"],
            },
          },
        ],
      },
      {
        id: "daily-3",
        title: "Stress quiet minute",
        summary: "A 60‑second pause lowers stress and resets focus.",
        tags: ["Mind"],
        moodTags: ["stress", "general"],
        heroImage:
          "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1200&q=80",
        iconKey: "smile",
        sections: [
          {
            heading: "Slow your breath",
            body: "Breathe in for 4, hold 2, out for 6. Repeat 4 times.",
            coach: "This downshifts the nervous system quickly.",
            question: {
              id: "q1",
              text: "Did you try the 4‑2‑6 breath?",
              options: ["Yes", "Not yet", "Need a reminder"],
            },
          },
        ],
      },
    ],
  };
}

const newsRoutes: FastifyPluginAsync = async (app) => {
  const aiService = buildAiService(app.config);

  app.get("/daily", async (request, reply) => {
    const query = request.query as { lat?: string; lon?: string; city?: string };
    const lat = Number(query.lat);
    const lon = Number(query.lon);

    let city = (query.city || "").trim();
    if (!city && Number.isFinite(lat) && Number.isFinite(lon)) {
      city = await reverseGeocode(lat, lon);
    }
    if (!city) city = "your area";

    const dayKey = new Date().toISOString().slice(0, 10);
    const cacheKey = `news:daily:${city.toLowerCase()}:${dayKey}`;
    const cached = await cacheGet<Record<string, unknown>>(cacheKey, app.config.REDIS_URL);
    if (cached) return reply.send({ status: "ok", data: cached });

    const queries = [
      `${city} health`,
      `${city} air quality`,
      `${city} pollution`,
      `${city} heatwave`,
      `${city} dengue`,
      `${city} flu`,
      "India health advisory",
      "India air quality",
      "India heatwave alert",
    ];

    const rssUrls = [
      WHO_NEWS_RSS,
      WHO_OUTBREAK_RSS,
      ...queries.map(buildGoogleNewsRss),
    ];

    const feeds = await Promise.all(rssUrls.map(fetchRss));
    const allItems = toRecent(feeds.flat(), 4);
    const unique = Array.from(new Map(allItems.map((item) => [item.title, item])).values()).slice(0, 30);

    if (unique.length === 0) {
      const fallback = fallbackTips(city);
      const shuffled = { ...fallback, tips: seededShuffle(fallback.tips, seedFromString(dayKey + city)) };
      await cacheSet(cacheKey, shuffled, 6 * 60 * 60, app.config.REDIS_URL);
      return reply.send({ status: "ok", data: shuffled });
    }

    try {
      const aiResult = await aiService.dailyHealthBrief({
        city,
        items: unique,
        dayKey,
      });
      const shuffled = { ...aiResult, tips: seededShuffle(aiResult.tips, seedFromString(dayKey + city)) };
      await cacheSet(cacheKey, shuffled, 6 * 60 * 60, app.config.REDIS_URL);
      return reply.send({ status: "ok", data: shuffled });
    } catch (error) {
      app.log.warn({ error }, "Failed to build AI daily tips, using fallback.");
      const fallback = fallbackTips(city);
      const shuffled = { ...fallback, tips: seededShuffle(fallback.tips, seedFromString(dayKey + city)) };
      await cacheSet(cacheKey, shuffled, 6 * 60 * 60, app.config.REDIS_URL);
      return reply.send({ status: "ok", data: shuffled });
    }
  });
};

export default newsRoutes;
