import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { requireMongo, requireSupabase } from "../core/data";

const integrationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mapbox-token", async () => {
    const token = (app.config.MAPBOX_TOKEN || "").trim();
    if (!token) {
      return { status: "error", message: "Mapbox token not configured" };
    }
    return { status: "ok", data: { token } };
  });

  app.get("/providers", async () => {
    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);

    const { data: providers, error } = await supabase
      .from("provider_integrations")
      .select("*, provider_integration_secrets(*)")
      .order("display_name", { ascending: true });
    if (error) {
      throw new Error(`Failed to list providers: ${error.message}`);
    }

    const providerKeys = (providers ?? []).map((item) => item.provider_key);
    const logRows = providerKeys.length
      ? await mongo
          .collection("integration_sync_logs")
          .find({ providerKey: { $in: providerKeys } })
          .sort({ startedAt: -1 })
          .limit(50)
          .toArray()
      : [];

    return { status: "ok", data: { providers: providers ?? [], logs: logRows } };
  });

  app.put("/providers/:providerKey", async (request) => {
    const { providerKey } = request.params as { providerKey: string };
    const body = request.body as {
      displayName?: string;
      status?: "active" | "inactive" | "error" | "testing";
      environment?: "dev" | "staging" | "prod";
      baseUrl?: string;
      env?: {
        appId?: string;
        apiKey?: string;
        secret?: string;
        endpoint?: string;
        modelId?: string;
      };
    };

    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await supabase
      .from("provider_integrations")
      .select("id, provider_key")
      .eq("provider_key", providerKey)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Failed to fetch provider integration: ${existingError.message}`);
    }
    if (!existing?.id) {
      throw new Error("Provider integration not found");
    }

    const { error } = await supabase
      .from("provider_integrations")
      .update({
        display_name: body.displayName ?? undefined,
        status: body.status ?? undefined,
        environment: body.environment ?? undefined,
        base_url: body.baseUrl ?? body.env?.endpoint ?? undefined,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) {
      throw new Error(`Failed to update provider integration: ${error.message}`);
    }

    const secretMap: Array<{ keyName: string; value?: string }> = [
      { keyName: "APP_ID", value: body.env?.appId },
      { keyName: "API_KEY", value: body.env?.apiKey },
      { keyName: "SECRET", value: body.env?.secret },
      { keyName: "ENDPOINT", value: body.env?.endpoint },
      { keyName: "MODEL_ID", value: body.env?.modelId },
    ];

    for (const item of secretMap) {
      if (typeof item.value !== "string") continue;
      const { data: existingSecret } = await supabase
        .from("provider_integration_secrets")
        .select("id")
        .eq("provider_integration_id", existing.id)
        .eq("key_name", item.keyName)
        .maybeSingle();

      if (existingSecret?.id) {
        await supabase
          .from("provider_integration_secrets")
          .update({
            secret_ref: item.value,
            is_active: true,
            last_rotated_at: now,
          })
          .eq("id", existingSecret.id);
      } else {
        await supabase.from("provider_integration_secrets").insert({
          id: crypto.randomUUID(),
          provider_integration_id: existing.id,
          key_name: item.keyName,
          secret_ref: item.value,
          is_active: true,
          last_rotated_at: now,
          created_at: now,
        });
      }
    }

    await mongo.collection("integration_sync_logs").insertOne({
      providerKey,
      syncType: "config_update",
      status: "completed",
      startedAt: now,
      finishedAt: now,
      summary: {
        environment: body.environment ?? null,
        updatedFields: Object.keys(body.env ?? {}),
      },
      schemaVersion: 1,
    });

    return { status: "ok", data: { providerKey } };
  });

  app.post("/providers/:providerKey/reload", async (request) => {
    const { providerKey } = request.params as { providerKey: string };
    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    const inserted = await mongo.collection("integration_sync_logs").insertOne({
      providerKey,
      syncType: "provider_reload",
      status: "queued",
      startedAt: now,
      finishedAt: null,
      summary: { action: "reload_requested" },
      schemaVersion: 1,
    });

    return { status: "ok", data: { runId: inserted.insertedId.toString(), providerKey } };
  });

  app.post("/providers/:providerKey/test", async (request) => {
    const { providerKey } = request.params as { providerKey: string };
    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    const inserted = await mongo.collection("integration_sync_logs").insertOne({
      providerKey,
      syncType: "health_test",
      status: "queued",
      startedAt: now,
      finishedAt: null,
      summary: { action: "health_test_requested" },
      schemaVersion: 1,
    });

    return { status: "ok", data: { runId: inserted.insertedId.toString(), providerKey } };
  });

  app.get("/sync-runs", async (request) => {
    const query = request.query as { providerKey?: string; limit?: number };
    const mongo = requireMongo(app);
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    const filter = query.providerKey ? { providerKey: query.providerKey } : {};
    const rows = await mongo.collection("integration_sync_logs").find(filter).sort({ startedAt: -1 }).limit(limit).toArray();
    return { status: "ok", data: rows };
  });
};

export default integrationsRoutes;
