import type { FastifyPluginAsync } from "fastify";

import { aiChatSchema, aiLabReadinessSchema } from "./ai.schema";
import { buildAiService } from "./ai.service";

const aiRoutes: FastifyPluginAsync = async (app) => {
  const aiService = buildAiService(app.config);

  app.post("/chat", { schema: aiChatSchema }, async (request, reply) => {
    const body = request.body as {
      message: string;
      history?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      apiKey?: string;
      temperature?: number;
      maxTokens?: number;
    };

    try {
      const data = await aiService.chat(body);
      return { status: "ok", data };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI request failed";
      const statusCode = /not configured/i.test(message) ? 503 : 502;
      return reply.code(statusCode).send({ status: "error", message });
    }
  });

  app.post(
    "/lab-readiness",
    { schema: aiLabReadinessSchema },
    async (request, reply) => {
      const body = request.body as {
        testName: string;
        fastingInfo?: string;
        apiKey?: string;
      };

      try {
        const data = await aiService.labReadinessQuestions(body);
        return { status: "ok", data };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "AI request failed";
        const statusCode = /not configured/i.test(message) ? 503 : 502;
        return reply.code(statusCode).send({ status: "error", message });
      }
    }
  );
};

export default aiRoutes;
