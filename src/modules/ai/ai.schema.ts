export const aiChatSchema = {
  body: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string", minLength: 1 },
      history: {
        type: "array",
        items: {
          type: "object",
          required: ["role", "content"],
          properties: {
            role: { type: "string", enum: ["system", "user", "assistant"] },
            content: { type: "string", minLength: 1 },
          },
        },
      },
      apiKey: { type: "string", minLength: 1 },
      temperature: { type: "number", minimum: 0, maximum: 2 },
      maxTokens: { type: "number", minimum: 64, maximum: 2048 },
    },
  },
} as const;

export const aiLabReadinessSchema = {
  body: {
    type: "object",
    required: ["testName"],
    properties: {
      testName: { type: "string", minLength: 1 },
      fastingInfo: { type: "string" },
      apiKey: { type: "string", minLength: 1 },
    },
  },
} as const;
