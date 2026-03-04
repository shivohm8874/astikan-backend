import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { enqueueOutboxEvent } from "../core/data";
import { buildAgoraRtcToken, buildZegoToken04 } from "./teleconsult.token";

type Provider = "zego" | "agora";
type SessionStatus = "scheduled" | "live" | "completed" | "cancelled";

type SessionRecord = {
  id: string;
  appointmentId: string | null;
  companyId: string;
  employeeId: string;
  doctorId: string;
  scheduledAt: string;
  status: SessionStatus;
  activeProvider: Provider;
  failoverCount: number;
  channelName: string;
  createdAt: string;
  updatedAt: string;
};

type PrescriptionRecord = {
  id: string;
  teleconsultSessionId: string;
  doctorId: string;
  notes: string;
  medicines: Array<{ name: string; dosage?: string; schedule?: string; duration?: string }>;
  followUpDate: string | null;
  fileUrl: string | null;
  createdAt: string;
};

const sessionsFallback = new Map<string, SessionRecord>();
const prescriptionsFallback = new Map<string, PrescriptionRecord>();

const hasSupabase = (app: Parameters<FastifyPluginAsync>[0]) => Boolean(app.dbClients.supabase);
const hasMongo = (app: Parameters<FastifyPluginAsync>[0]) => Boolean(app.dbClients.mongo);

function buildRtcPayload(params: {
  app: Parameters<FastifyPluginAsync>[0];
  provider: Provider;
  channelName: string;
  userId: string;
}) {
  const { app, provider, channelName, userId } = params;
  if (provider === "zego") {
    const appId = Number(app.config.ZEGO_APP_ID);
    const strictPayload = JSON.stringify({
      room_id: channelName,
      privilege: {
        1: 1, // loginRoom
        2: 1, // publishStream
      },
      stream_id_list: null,
    });
    const token = buildZegoToken04({
      appId,
      userId,
      secret: app.config.ZEGO_SERVER_SECRET,
      payload: strictPayload,
    });
    return {
      provider,
      appId: app.config.ZEGO_APP_ID,
      userId,
      channelName,
      token,
    };
  }

  const token = buildAgoraRtcToken({
    appId: app.config.AGORA_APP_ID,
    appCertificate: app.config.AGORA_APP_CERTIFICATE,
    channelName,
    userId,
  });
  return {
    provider,
    appId: app.config.AGORA_APP_ID,
    userId,
    channelName,
    token,
  };
}

function chooseProvider(
  preferred: Provider | undefined,
  app: Parameters<FastifyPluginAsync>[0],
  forceFallback = false
): Provider {
  const zegoConfigured = Boolean(app.config.ZEGO_APP_ID);
  const agoraConfigured = Boolean(app.config.AGORA_APP_ID);

  const firstChoice: Provider = preferred ?? "zego";
  const fallbackChoice: Provider = firstChoice === "zego" ? "agora" : "zego";

  if (forceFallback) {
    return fallbackChoice;
  }

  if (firstChoice === "zego" && zegoConfigured) {
    return "zego";
  }
  if (firstChoice === "agora" && agoraConfigured) {
    return "agora";
  }
  if (fallbackChoice === "zego" && zegoConfigured) {
    return "zego";
  }
  if (fallbackChoice === "agora" && agoraConfigured) {
    return "agora";
  }

  return firstChoice;
}

async function persistMongoEvent(
  app: Parameters<FastifyPluginAsync>[0],
  event: {
    teleconsultSessionId: string;
    companyId?: string;
    employeeId?: string;
    doctorId?: string;
    eventType: string;
    payload?: Record<string, unknown>;
  }
) {
  if (!hasMongo(app)) {
    return;
  }
  try {
    await app.dbClients.mongo!.collection("teleconsult_events").insertOne({
      ...event,
      source: "backend-api",
      schemaVersion: 1,
      eventAt: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
    });
  } catch (error) {
    app.log.warn({ error }, "Skipping teleconsult Mongo event write");
  }
}

const teleconsultRoutes: FastifyPluginAsync = async (app) => {
  app.post("/sessions", async (request) => {
    const body = request.body as {
      appointmentId?: string;
      companyId: string;
      employeeId: string;
      doctorId: string;
      scheduledAt?: string;
      preferredProvider?: Provider;
    };

    if (!body.companyId || !body.employeeId || !body.doctorId) {
      throw new Error("companyId, employeeId and doctorId are required");
    }

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const activeProvider = chooseProvider(body.preferredProvider, app);
    const session: SessionRecord = {
      id: sessionId,
      appointmentId: body.appointmentId ?? null,
      companyId: body.companyId,
      employeeId: body.employeeId,
      doctorId: body.doctorId,
      scheduledAt: body.scheduledAt ?? now,
      status: "scheduled",
      activeProvider,
      failoverCount: 0,
      channelName: `astikan-${sessionId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    };

    if (hasSupabase(app)) {
      const { error } = await app.dbClients.supabase!.from("teleconsult_sessions").insert({
        id: session.id,
        appointment_id: session.appointmentId,
        company_id: session.companyId,
        employee_id: session.employeeId,
        doctor_id: session.doctorId,
        scheduled_at: session.scheduledAt,
        status: session.status,
        active_provider: session.activeProvider,
        failover_count: session.failoverCount,
        channel_name: session.channelName,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      });

      if (error) {
        app.log.warn({ error }, "teleconsult_sessions insert failed; using in-memory fallback");
        sessionsFallback.set(session.id, session);
      }
    } else {
      sessionsFallback.set(session.id, session);
    }

    try {
      if (hasSupabase(app)) {
        await enqueueOutboxEvent(app, {
          event_type: "teleconsult.session.created",
          aggregate_type: "teleconsult_session",
          aggregate_id: session.id,
          payload: {
            companyId: session.companyId,
            employeeId: session.employeeId,
            doctorId: session.doctorId,
            provider: session.activeProvider,
          },
          idempotency_key: `teleconsult-session-created:${session.id}`,
        });
      }
    } catch (error) {
      app.log.warn({ error }, "Failed to enqueue teleconsult created event");
    }

    await persistMongoEvent(app, {
      teleconsultSessionId: session.id,
      companyId: session.companyId,
      employeeId: session.employeeId,
      doctorId: session.doctorId,
      eventType: "session_created",
      payload: { provider: session.activeProvider },
    });

    return {
      status: "ok",
      data: {
        sessionId: session.id,
        status: session.status,
        provider: session.activeProvider,
        channelName: session.channelName,
        rtc: buildRtcPayload({
          app,
          provider: session.activeProvider,
          channelName: session.channelName,
          userId: session.employeeId,
        }),
      },
    };
  });

  app.post("/sessions/:id/join", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      participantType?: "employee" | "doctor";
      participantId?: string;
      forceFailover?: boolean;
      preferredProvider?: Provider;
    };

    let session: SessionRecord | null = null;
    if (hasSupabase(app)) {
      const { data } = await app.dbClients.supabase!
        .from("teleconsult_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (data) {
        session = {
          id: data.id,
          appointmentId: data.appointment_id,
          companyId: data.company_id,
          employeeId: data.employee_id,
          doctorId: data.doctor_id,
          scheduledAt: data.scheduled_at,
          status: data.status,
          activeProvider: data.active_provider,
          failoverCount: data.failover_count ?? 0,
          channelName: data.channel_name ?? `astikan-${id.slice(0, 8)}`,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    }

    if (!session) {
      session = sessionsFallback.get(id) ?? null;
    }

    if (!session) {
      throw new Error("Teleconsult session not found");
    }

    const nextProvider = chooseProvider(
      body.preferredProvider ?? session.activeProvider,
      app,
      Boolean(body.forceFailover)
    );
    const shouldIncreaseFailover =
      Boolean(body.forceFailover) || (session.activeProvider !== nextProvider && session.status === "live");

    session.status = "live";
    session.activeProvider = nextProvider;
    session.updatedAt = new Date().toISOString();
    if (shouldIncreaseFailover) {
      session.failoverCount += 1;
    }

    if (hasSupabase(app)) {
      const { error } = await app.dbClients.supabase!
        .from("teleconsult_sessions")
        .update({
          status: session.status,
          active_provider: session.activeProvider,
          failover_count: session.failoverCount,
          updated_at: session.updatedAt,
        })
        .eq("id", session.id);

      if (error) {
        app.log.warn({ error }, "teleconsult_sessions update failed; using in-memory state");
      }
    }
    sessionsFallback.set(session.id, session);

    await persistMongoEvent(app, {
      teleconsultSessionId: session.id,
      companyId: session.companyId,
      employeeId: session.employeeId,
      doctorId: session.doctorId,
      eventType: "participant_joined",
      payload: {
        participantType: body.participantType ?? "employee",
        participantId: body.participantId ?? null,
        provider: session.activeProvider,
        failoverCount: session.failoverCount,
      },
    });

    return {
      status: "ok",
      data: {
        sessionId: session.id,
        sessionStatus: session.status,
        provider: session.activeProvider,
        failoverCount: session.failoverCount,
        channelName: session.channelName,
        rtc: buildRtcPayload({
          app,
          provider: session.activeProvider,
          channelName: session.channelName,
          userId:
            body.participantId ??
            (body.participantType === "doctor" ? session.doctorId : session.employeeId),
        }),
      },
    };
  });

  app.post("/sessions/:id/prescription", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      doctorId: string;
      notes: string;
      medicines?: Array<{ name: string; dosage?: string; schedule?: string; duration?: string }>;
      followUpDate?: string;
      fileUrl?: string;
    };

    if (!body.doctorId || !body.notes) {
      throw new Error("doctorId and notes are required");
    }

    const prescription: PrescriptionRecord = {
      id: crypto.randomUUID(),
      teleconsultSessionId: id,
      doctorId: body.doctorId,
      notes: body.notes,
      medicines: Array.isArray(body.medicines) ? body.medicines : [],
      followUpDate: body.followUpDate ?? null,
      fileUrl: body.fileUrl ?? null,
      createdAt: new Date().toISOString(),
    };

    if (hasSupabase(app)) {
      const { error } = await app.dbClients.supabase!.from("prescription_headers").insert({
        id: prescription.id,
        teleconsult_session_id: prescription.teleconsultSessionId,
        doctor_id: prescription.doctorId,
        notes: prescription.notes,
        medicines_json: prescription.medicines,
        follow_up_date: prescription.followUpDate,
        file_url: prescription.fileUrl,
        created_at: prescription.createdAt,
      });
      if (error) {
        app.log.warn({ error }, "prescription_headers insert failed; using in-memory fallback");
      }
    }
    prescriptionsFallback.set(id, prescription);

    await persistMongoEvent(app, {
      teleconsultSessionId: id,
      doctorId: body.doctorId,
      eventType: "prescription_created",
      payload: {
        prescriptionId: prescription.id,
        medicineCount: prescription.medicines.length,
      },
    });

    return {
      status: "ok",
      data: {
        prescriptionId: prescription.id,
        teleconsultSessionId: prescription.teleconsultSessionId,
      },
    };
  });

  app.get("/sessions/:id/prescription", async (request) => {
    const { id } = request.params as { id: string };

    if (hasSupabase(app)) {
      const { data } = await app.dbClients.supabase!
        .from("prescription_headers")
        .select("*")
        .eq("teleconsult_session_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          status: "ok",
          data: {
            id: data.id,
            teleconsultSessionId: data.teleconsult_session_id,
            doctorId: data.doctor_id,
            notes: data.notes ?? "",
            medicines: data.medicines_json ?? [],
            followUpDate: data.follow_up_date ?? null,
            fileUrl: data.file_url ?? null,
            createdAt: data.created_at,
          },
        };
      }
    }

    const fallback = prescriptionsFallback.get(id);
    if (!fallback) {
      return {
        status: "ok",
        data: null,
      };
    }

    return {
      status: "ok",
      data: fallback,
    };
  });
};

export default teleconsultRoutes;
