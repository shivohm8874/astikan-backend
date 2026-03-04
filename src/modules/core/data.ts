import type { FastifyInstance } from "fastify";

export function requireSupabase(app: FastifyInstance) {
  if (!app.dbClients.supabase) {
    throw new Error("Supabase is not configured");
  }
  return app.dbClients.supabase;
}

export function requireMongo(app: FastifyInstance) {
  if (!app.dbClients.mongo) {
    throw new Error("MongoDB is not configured");
  }
  return app.dbClients.mongo;
}

export async function enqueueOutboxEvent(
  app: FastifyInstance,
  event: {
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    idempotency_key?: string;
  }
) {
  const supabase = requireSupabase(app);
  const idempotencyKey =
    event.idempotency_key ?? `${event.aggregate_type}:${event.aggregate_id}:${event.event_type}`;

  const { error } = await supabase.from("outbox_events").insert({
    event_type: event.event_type,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    payload_json: event.payload,
    idempotency_key: idempotencyKey,
    status: "pending",
  });

  if (error) {
    throw new Error(`Failed to enqueue outbox event: ${error.message}`);
  }
}
