import type { FastifyPluginAsync } from "fastify";
import { requireMongo } from "../core/data";

const behaviorRoutes: FastifyPluginAsync = async (app) => {
  app.post("/signal", async (request) => {
    const body = request.body as {
      type: string;
      label?: string;
      tags?: string[];
      meta?: Record<string, unknown>;
      source?: string;
      userId?: string | null;
      companyId?: string | null;
    };

    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    await mongo.collection("behavior_audit_logs").insertOne({
      type: body.type,
      label: body.label ?? null,
      tags: body.tags ?? [],
      meta: body.meta ?? {},
      source: body.source ?? "unknown",
      userId: body.userId ?? null,
      companyId: body.companyId ?? null,
      eventAt: now,
      schemaVersion: 1,
    });

    return { status: "ok", data: { stored: true } };
  });
};

export default behaviorRoutes;
