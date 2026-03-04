import axios from "axios";

import type { AppEnv } from "../../config/env";

type AiConfig = Pick<AppEnv, "GROK_API_KEY" | "GROK_BASE_URL" | "GROK_MODEL">;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatParams = {
  message: string;
  history?: ChatMessage[];
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
};

type SuggestedTest = {
  name: string;
  reason?: string;
  category?: string;
};
type AiPhase = "clarify" | "recommend";
type AiMeta = {
  phase: AiPhase;
  quickReplies: string[];
  tests?: SuggestedTest[];
};

export type ReadinessQuestion = {
  id: string;
  question: string;
  options: Array<{ value: "yes" | "no"; label: string }>;
};

const parseSuggestedTests = (text: string): {
  cleanedReply: string;
  suggestedTests: SuggestedTest[];
} => {
  let cleanedReply = text;
  let suggestedTests: SuggestedTest[] = [];

  const widgetMatch = text.match(/TEST_WIDGET_JSON:\s*(\{[\s\S]*\})/i);
  if (widgetMatch?.[1]) {
    try {
      const parsed = JSON.parse(widgetMatch[1]) as { tests?: SuggestedTest[] };
      suggestedTests = (parsed.tests ?? [])
        .filter((item) => item?.name && item.name.trim().length > 0)
        .slice(0, 5);
      cleanedReply = text.replace(widgetMatch[0], "").trim();
    } catch {
      // Fallback parser below.
    }
  }

  if (suggestedTests.length === 0) {
    const lines = cleanedReply.split(/\r?\n/);
    suggestedTests = lines
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
      .filter((line) => line.length > 0 && line.length < 120)
      .slice(0, 5)
      .map((name) => ({ name }));
  }

  return { cleanedReply, suggestedTests };
};

const normalizeReplyText = (input: string): string => {
  return input
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const parseAiMeta = (raw: string): {
  cleanedReply: string;
  phase: AiPhase;
  quickReplies: string[];
  suggestedTests: SuggestedTest[];
} => {
  let cleanedReply = raw;
  let phase: AiPhase = "clarify";
  let quickReplies: string[] = [];
  let suggestedTests: SuggestedTest[] = [];

  const metaMatch = raw.match(/AI_META_JSON:\s*(\{[\s\S]*\})/i);
  if (metaMatch?.[1]) {
    try {
      const parsed = JSON.parse(metaMatch[1]) as AiMeta;
      const parsedPhase = parsed.phase === "recommend" ? "recommend" : "clarify";
      phase = parsedPhase;
      quickReplies = (parsed.quickReplies ?? [])
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0)
        .slice(0, 3);
      suggestedTests = (parsed.tests ?? [])
        .filter((item) => item?.name && item.name.trim().length > 0)
        .slice(0, 5);
      cleanedReply = raw.replace(metaMatch[0], "").trim();
    } catch {
      // Fallback below.
    }
  }

  if (suggestedTests.length === 0) {
    const parsed = parseSuggestedTests(cleanedReply);
    cleanedReply = parsed.cleanedReply;
    suggestedTests = parsed.suggestedTests;
  }

  cleanedReply = normalizeReplyText(cleanedReply);

  if (quickReplies.length === 0) {
    quickReplies =
      phase === "recommend"
        ? ["Show top 3 tests only", "How should I prepare?", "Book one now"]
        : ["It started this morning", "I also feel dizzy", "What should I check first?"];
  }

  return { cleanedReply, phase, quickReplies, suggestedTests };
};

const defaultReadinessQuestions = (testName: string): ReadinessQuestion[] => [
  {
    id: "fasting_ready",
    question: `For ${testName}, have you followed the advised fasting/preparation?`,
    options: [
      { value: "yes", label: "Yes, I followed it" },
      { value: "no", label: "No, not yet" },
    ],
  },
  {
    id: "medication_note",
    question: "Did you take any medicines today that the lab should know about?",
    options: [
      { value: "yes", label: "Yes, I took medicine" },
      { value: "no", label: "No, none today" },
    ],
  },
  {
    id: "comfort_ready",
    question: "Are you feeling comfortable and ready for sample collection now?",
    options: [
      { value: "yes", label: "Yes, ready" },
      { value: "no", label: "No, I need support" },
    ],
  },
];

const parseReadinessQuestions = (
  raw: string,
  testName: string
): ReadinessQuestion[] => {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return defaultReadinessQuestions(testName);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      questions?: Array<{
        id?: string;
        question?: string;
        options?: Array<{ value?: string; label?: string }>;
      }>;
    };

    const normalized = (parsed.questions ?? [])
      .slice(0, 3)
      .map((item, idx) => {
        const question = (item.question || "").trim();
        if (!question) {
          return null;
        }
        const yesLabel =
          item.options?.find((o) => o.value === "yes")?.label?.trim() ||
          "Yes";
        const noLabel =
          item.options?.find((o) => o.value === "no")?.label?.trim() || "No";
        return {
          id: item.id?.trim() || `q_${idx + 1}`,
          question,
          options: [
            { value: "yes" as const, label: yesLabel },
            { value: "no" as const, label: noLabel },
          ],
        };
      })
      .filter((item): item is ReadinessQuestion => !!item);

    if (normalized.length === 3) {
      return normalized;
    }
  } catch {
    // Fall through to default questions.
  }

  return defaultReadinessQuestions(testName);
};

export const buildAiService = (config: AiConfig) => {
  return {
    chat: async ({
      message,
      history = [],
      apiKey,
      temperature = 0.35,
      maxTokens = 700,
    }: ChatParams): Promise<{
      reply: string;
      provider: string;
      model: string;
      phase: AiPhase;
      quickReplies: string[];
      suggestedTests: SuggestedTest[];
    }> => {
      const resolvedApiKey = (apiKey || config.GROK_API_KEY || "").trim();
      if (!resolvedApiKey) {
        throw new Error("Grok API key is not configured");
      }

      const model = config.GROK_MODEL || "grok-4-1-fast-reasoning";
      const baseUrl = (config.GROK_BASE_URL || "https://api.x.ai/v1").replace(
        /\/+$/,
        ""
      );

      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are a caring human-like health assistant for lab-test guidance. Keep replies short (4-8 lines), warm, and practical. Do not diagnose. Avoid markdown headings (#), avoid dash bullets (-), avoid robotic formatting. Use natural plain sentences; bold only when important using **text**; emojis are allowed sparingly. Conversation policy: first ask 1 clear clarifying question at a time for up to 2-3 turns (phase=clarify). Once enough details are known, suggest up to 5 relevant tests with brief reasons (phase=recommend). IMPORTANT: quickReplies must be user-side tap replies, written in first-person as if the user is sending them (example: \"I also feel dizzy\", \"This started yesterday\", \"I want to book one now\"). Never write assistant-side commands. Always append exactly one line AI_META_JSON:{\"phase\":\"clarify|recommend\",\"quickReplies\":[\"...\",\"...\",\"...\"],\"tests\":[{\"name\":\"...\",\"category\":\"...\",\"reason\":\"...\"}]} as valid minified JSON.",
        },
        ...history.slice(-10),
        { role: "user", content: message },
      ];

      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        },
        {
          timeout: 30000,
          headers: {
            Authorization: `Bearer ${resolvedApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const rawReply =
        response.data?.choices?.[0]?.message?.content?.trim?.() ||
        "I could not generate a response right now.";
      const { cleanedReply, phase, quickReplies, suggestedTests } =
        parseAiMeta(rawReply);

      return {
        reply: cleanedReply,
        provider: "grok",
        model,
        phase,
        quickReplies,
        suggestedTests,
      };
    },
    labReadinessQuestions: async ({
      testName,
      fastingInfo,
      apiKey,
    }: {
      testName: string;
      fastingInfo?: string;
      apiKey?: string;
    }): Promise<{ questions: ReadinessQuestion[]; model: string }> => {
      const resolvedApiKey = (apiKey || config.GROK_API_KEY || "").trim();
      if (!resolvedApiKey) {
        throw new Error("Grok API key is not configured");
      }

      const model = config.GROK_MODEL || "grok-4-1-fast-reasoning";
      const baseUrl = (config.GROK_BASE_URL || "https://api.x.ai/v1").replace(
        /\/+$/,
        ""
      );

      const userPrompt = [
        `Test name: ${testName}`,
        fastingInfo ? `Preparation note: ${fastingInfo}` : "",
        "Create exactly 3 patient-friendly readiness questions before booking this test.",
        "Each question must have only yes/no options with simple labels.",
        'Return ONLY valid minified JSON in this shape: {"questions":[{"id":"...","question":"...","options":[{"value":"yes","label":"..."},{"value":"no","label":"..."}]}]}',
      ]
        .filter(Boolean)
        .join("\n");

      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            {
              role: "system",
              content:
                "You generate short, friendly patient readiness questions for lab test booking. Output JSON only.",
            },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 500,
        },
        {
          timeout: 30000,
          headers: {
            Authorization: `Bearer ${resolvedApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const raw =
        response.data?.choices?.[0]?.message?.content?.trim?.() || "";
      const questions = parseReadinessQuestions(raw, testName);
      return { questions, model };
    },
  };
};
