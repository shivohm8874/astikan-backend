import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { GridFSBucket, MongoClient, type Db } from "mongodb";

type DbClients = {
  supabase: SupabaseClient | null;
  mongo: Db | null;
  mongoBucket: GridFSBucket | null;
};

const dbPlugin: FastifyPluginAsync = async (app) => {
  let supabase: SupabaseClient | null = null;
  let mongoClient: MongoClient | null = null;
  let mongo: Db | null = null;
  let mongoBucket: GridFSBucket | null = null;

  if (app.config.SUPABASE_URL && app.config.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
      app.config.SUPABASE_URL,
      app.config.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  } else {
    app.log.warn("Supabase env is missing. Transactional endpoints will be unavailable.");
  }

  if (app.config.MONGODB_URI) {
    try {
      mongoClient = new MongoClient(app.config.MONGODB_URI, {
        ignoreUndefined: true,
        connectTimeoutMS: 8000,
        serverSelectionTimeoutMS: 8000,
      });
      await mongoClient.connect();
      mongo = mongoClient.db(app.config.MONGODB_DB_NAME);
      mongoBucket = new GridFSBucket(mongo, {
        bucketName: "large_assets",
      });

      try {
        await Promise.all([
          mongo.collection("assessment_responses").createIndex({ employeeId: 1, eventAt: -1 }),
          mongo.collection("teleconsult_events").createIndex({ teleconsultSessionId: 1, eventAt: -1 }),
          mongo.collection("chat_threads").createIndex({ threadId: 1, createdAt: -1 }),
          mongo.collection("ai_insights").createIndex({ employeeId: 1, eventAt: -1 }),
          mongo.collection("stress_sessions").createIndex({ employeeId: 1, eventAt: -1 }),
          mongo.collection("health_signals").createIndex({ employeeId: 1, eventAt: -1 }),
          mongo.collection("document_metadata").createIndex({ ownerId: 1, createdAt: -1 }),
          mongo.collection("behavior_audit_logs").createIndex({ eventAt: -1 }),
          mongo.collection("appointment_events").createIndex({ appointmentId: 1, eventAt: -1 }),
          mongo.collection("lab_order_events").createIndex({ labOrderId: 1, eventAt: -1 }),
          mongo.collection("pharmacy_order_events").createIndex({ orderId: 1, eventAt: -1 }),
          mongo.collection("notification_delivery_logs").createIndex({ userId: 1, createdAt: -1 }),
          mongo.collection("provider_webhook_events").createIndex({ providerKey: 1, eventAt: -1 }),
          mongo.collection("integration_sync_logs").createIndex({ providerKey: 1, startedAt: -1 }),
          mongo.collection("system_error_logs").createIndex({ eventAt: -1, severity: 1, module: 1 }),
          mongo.collection("program_activity_events").createIndex({ programId: 1, eventAt: -1 }),
          mongo.collection("freelance_case_events").createIndex({ caseRequestId: 1, eventAt: -1 }),
          mongo.collection("lab_report_views").createIndex({ labOrderId: 1, viewedAt: -1 }),
        ]);
      } catch (error) {
        app.log.warn({ error }, "Mongo index creation skipped (provider/endpoint may not support createIndexes)");
      }
    } catch (error) {
      app.log.warn({ error }, "MongoDB connect failed. Continuing without Mongo.");
      if (mongoClient) {
        try {
          await mongoClient.close();
        } catch {
          // ignore close errors
        }
      }
      mongoClient = null;
      mongo = null;
      mongoBucket = null;
    }
  } else {
    app.log.warn("MongoDB URI missing. Behavioral and large-asset endpoints will be unavailable.");
  }

  app.decorate("dbClients", {
    supabase,
    mongo,
    mongoBucket,
  } satisfies DbClients);

  app.addHook("onClose", async () => {
    if (mongoClient) {
      await mongoClient.close();
    }
  });
};

export default fp(dbPlugin);
