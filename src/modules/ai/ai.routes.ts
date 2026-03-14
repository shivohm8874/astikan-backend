import type { FastifyPluginAsync } from "fastify";

import { aiChatSchema, aiLabReadinessSchema } from "./ai.schema";
import { buildAiService } from "./ai.service";

const aiRoutes: FastifyPluginAsync = async (app) => {
  const aiService = buildAiService(app.config);

  app.get("/threads/:threadId", async (request) => {
    const { threadId } = request.params as { threadId: string };
    const mongo = app.dbClients.mongo;
    if (!mongo) {
      return { status: "ok", data: [] };
    }
    const messages = await mongo
      .collection("chat_threads")
      .find({ threadId })
      .sort({ createdAt: 1 })
      .limit(200)
      .toArray();
    return { status: "ok", data: messages };
  });

  app.post("/chat", { schema: aiChatSchema }, async (request, reply) => {
    const body = request.body as {
      message: string;
      history?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      apiKey?: string;
      temperature?: number;
      maxTokens?: number;
      threadId?: string;
      userId?: string;
      appContext?: string;
    };

    try {
      const mongo = app.dbClients.mongo;
      const now = new Date().toISOString();
      if (body.threadId && mongo) {
        await mongo.collection("chat_threads").insertOne({
          threadId: body.threadId,
          userId: body.userId ?? null,
          appContext: body.appContext ?? "generic",
          role: "user",
          content: body.message,
          createdAt: now,
        });
      }

      const data = await aiService.chat(body);

      if (body.threadId && mongo) {
        await mongo.collection("chat_threads").insertOne({
          threadId: body.threadId,
          userId: body.userId ?? null,
          appContext: body.appContext ?? "generic",
          role: "assistant",
          content: data.reply,
          meta: {
            provider: data.provider,
            model: data.model,
            phase: data.phase,
            quickReplies: data.quickReplies,
            suggestedTests: data.suggestedTests,
            suggestedMedicines: data.suggestedMedicines,
            doctorSpecialty: data.doctorSpecialty,
            nextAction: data.nextAction,
          },
          createdAt: new Date().toISOString(),
        });
      }

      if (body.userId && mongo) {
        await mongo.collection("ai_insights").insertOne({
          employeeId: body.appContext === "employee" ? body.userId : null,
          doctorId: body.appContext === "doctor" ? body.userId : null,
          threadId: body.threadId ?? null,
          appContext: body.appContext ?? "generic",
          eventType: "ai_chat_response",
          prompt: body.message,
          reply: data.reply,
          provider: data.provider,
          model: data.model,
          eventAt: new Date().toISOString(),
        });
      }

      return { status: "ok", data };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "AI request failed";
      try {
        const mongo = app.dbClients.mongo;
        if (mongo) {
          await mongo.collection("system_error_logs").insertOne({
            service: "backend-api",
            module: "ai",
            severity: "error",
            message,
            stack: error instanceof Error ? error.stack ?? null : null,
            context: {
              route: "/api/ai/chat",
              appContext: body.appContext ?? "generic",
              threadId: body.threadId ?? null,
              userId: body.userId ?? null,
            },
            eventAt: new Date().toISOString(),
            schemaVersion: 1,
          });
        }
      } catch {
        // Keep error reporting best-effort.
      }
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
