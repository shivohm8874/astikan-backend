import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { requireMongo, requireSupabase } from "../modules/core/data";

const POLL_MS = 5000;

const outboxWorkerPlugin: FastifyPluginAsync = async (app) => {
  let timer: NodeJS.Timeout | null = null;

  const run = async () => {
    try {
      const supabase = requireSupabase(app);
      const mongo = requireMongo(app);

      const { data, error } = await supabase
        .from("outbox_events")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(50);

      if (error || !data?.length) {
        return;
      }

      for (const event of data) {
        try {
          await mongo.collection("behavior_audit_logs").updateOne(
            { outboxEventId: event.id },
            {
              $setOnInsert: {
                outboxEventId: event.id,
                eventType: event.event_type,
                aggregateType: event.aggregate_type,
                aggregateId: event.aggregate_id,
                payload: event.payload_json,
                eventAt: event.created_at,
                ingestedAt: new Date().toISOString(),
                source: "outbox-worker",
                schemaVersion: 1,
              },
            },
            { upsert: true }
          );

          await supabase
            .from("outbox_events")
            .update({
              status: "processed",
              processed_at: new Date().toISOString(),
              retry_count: event.retry_count ?? 0,
              last_error: null,
            })
            .eq("id", event.id);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown outbox processing error";
          await supabase
            .from("outbox_events")
            .update({
              status: "failed",
              retry_count: (event.retry_count ?? 0) + 1,
              last_error: message,
            })
            .eq("id", event.id);
        }
      }
    } catch {
      // Keep worker silent when DBs are not configured.
    }
  };

  app.addHook("onReady", async () => {
    timer = setInterval(() => {
      void run();
    }, POLL_MS);
  });

  app.addHook("onClose", async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
};

export default fp(outboxWorkerPlugin);
