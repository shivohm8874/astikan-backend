import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyPluginAsync } from "fastify";

import { enqueueOutboxEvent, requireMongo, requireMongoBucket, requireSupabase } from "../core/data";
import { ensureCompanyByReference, ensureEmployeePrincipal } from "../core/identity";
import {
  catalogQuerySchema,
  cancelOrderSchema,
  pincodeQuerySchema,
  pincodeSchema,
  referenceSchema,
  rescheduleOrderSchema,
  searchTestBodySchema,
  searchTestSchema,
  sendNotificationSchema,
  testDescriptionBodySchema,
  testDescriptionSchema,
} from "./lab.schema";
import {
  buildLabService,
  type CancelOrderBody,
  type RescheduleOrderBody,
} from "./lab.service";

const LAB_CACHE_PRELOAD_KEYWORDS = [
  "",
  "cbc",
  "complete blood count",
  "blood test",
  "hba1c",
  "blood sugar",
  "glucose",
  "fasting sugar",
  "post prandial",
  "lipid profile",
  "cholesterol",
  "hdl",
  "ldl",
  "triglycerides",
  "liver function",
  "lft",
  "sgpt",
  "sgot",
  "bilirubin",
  "kidney function",
  "kft",
  "creatinine",
  "urea",
  "uric acid",
  "thyroid",
  "thyroid profile",
  "tsh",
  "t3",
  "t4",
  "vitamin d",
  "vitamin b12",
  "b12",
  "iron profile",
  "ferritin",
  "esr",
  "crp",
  "dengue",
  "malaria",
  "widal",
  "typhoid",
  "fever profile",
  "urine routine",
  "urine culture",
  "electrolytes",
  "calcium",
  "hormone",
  "insulin",
  "testosterone",
  "allergy",
  "ige",
];

const labRoutes: FastifyPluginAsync = async (app) => {
  const labService = buildLabService(app.config);
  void labService
    .warmCatalogCache(LAB_CACHE_PRELOAD_KEYWORDS)
    .then(() => app.log.info("Lab cache warmup completed"))
    .catch((error) => app.log.warn({ error }, "Lab cache warmup failed"));

  app.get(
    "/catalog",
    { schema: catalogQuerySchema },
    async (request) => {
      const query = request.query as {
        keyword?: string;
        limit?: number;
        offset?: number;
      };
      const keyword = typeof query.keyword === "string" ? query.keyword : "";
      const limit = typeof query.limit === "number" ? query.limit : 1500;
      const offset = typeof query.offset === "number" ? query.offset : 0;
      const data = await labService.catalog(keyword, limit, offset);
      return { status: "ok", data };
    }
  );

  app.get("/orders", async (request, reply) => {
    const { employeeId } = request.query as { employeeId?: string };
    if (!employeeId) {
      return reply.code(400).send({ status: "error", message: "employeeId is required" });
    }
    const supabase = requireSupabase(app);
    const { data, error } = await supabase
      .from("lab_orders")
      .select(
        "id, provider_order_reference, status, slot_at, created_at, report_storage_key, lab_test_catalog:lab_test_catalog_id(name, provider_test_code)"
      )
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch lab orders: ${error.message}`);
    }

    return { status: "ok", data: data ?? [] };
  });

  app.get("/orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const supabase = requireSupabase(app);
    const { data, error } = await supabase
      .from("lab_orders")
      .select(
        "id, provider_order_reference, status, slot_at, created_at, report_storage_key, lab_test_catalog:lab_test_catalog_id(name, provider_test_code)"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch lab order: ${error.message}`);
    }

    if (!data) {
      return reply.code(404).send({ status: "error", message: "Order not found" });
    }

    return { status: "ok", data };
  });

  app.get("/orders/:id/report-link", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { employeeId } = request.query as { employeeId?: string };
    if (!employeeId) {
      return reply.code(400).send({ status: "error", message: "employeeId is required" });
    }
    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);
    const { data, error } = await supabase
      .from("lab_orders")
      .select("id, report_storage_key, employee_id")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch lab order report: ${error.message}`);
    }

    if (!data || data.employee_id !== employeeId) {
      return reply.code(403).send({ status: "error", message: "Unauthorized" });
    }

    const reportKey = data.report_storage_key;
    if (!reportKey) {
      return reply.code(404).send({ status: "error", message: "Report not available" });
    }

    if (typeof reportKey === "string" && reportKey.startsWith("http")) {
      return { status: "ok", data: { url: reportKey } };
    }

    const baseUrl =
      (app.config.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "") ||
      `${request.protocol}://${request.hostname}`;

    return { status: "ok", data: { url: `${baseUrl}/api/lab/orders/${id}/report?employeeId=${encodeURIComponent(employeeId)}` } };
  });

  app.get("/orders/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { employeeId } = request.query as { employeeId?: string };
    if (!employeeId) {
      return reply.code(400).send({ status: "error", message: "employeeId is required" });
    }
    const supabase = requireSupabase(app);
    const mongoBucket = requireMongoBucket(app);
    const { data, error } = await supabase
      .from("lab_orders")
      .select("id, report_storage_key, employee_id")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch lab order report: ${error.message}`);
    }

    if (!data || data.employee_id !== employeeId) {
      return reply.code(403).send({ status: "error", message: "Unauthorized" });
    }

    const reportKey = data.report_storage_key;
    if (!reportKey) {
      return reply.code(404).send({ status: "error", message: "Report not available" });
    }

    if (!mongoBucket) {
      return reply.code(503).send({ status: "error", message: "Report storage unavailable" });
    }

    const key = String(reportKey);
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(key);
    const { ObjectId } = await import("mongodb");
    await mongo.collection("lab_report_views").insertOne({
      labOrderId: id,
      employeeId,
      reportKey: key,
      viewedAt: new Date().toISOString(),
      source: "employee_app",
    });
    const stream = isObjectId
      ? mongoBucket.openDownloadStream(new ObjectId(key))
      : mongoBucket.openDownloadStreamByName(key);

    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", "inline; filename=\"lab-report.pdf\"");
    return reply.send(stream);
  });

  app.get("/orders/stream", async (request, reply) => {
    const { employeeId } = request.query as { employeeId?: string };
    if (!employeeId) {
      return reply.code(400).send({ status: "error", message: "employeeId is required" });
    }

    const supabase = requireSupabase(app);
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    let active = true;
    let lastSnapshot = new Map<string, string>();

    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const poll = async () => {
      if (!active) return;
      const { data, error } = await supabase
        .from("lab_orders")
        .select("id, status, report_storage_key, lab_test_catalog:lab_test_catalog_id(name)")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false });

      if (error || !data) {
        sendEvent("error", { message: "Unable to fetch lab orders" });
        return;
      }

      const updates: Array<{ id: string; status: string; testName: string; reportReady: boolean }> = [];
      data.forEach((row) => {
        const status = String(row.status ?? "created");
        const prev = lastSnapshot.get(row.id);
        if (prev !== status) {
          updates.push({
            id: row.id,
            status,
            testName: row.lab_test_catalog?.name ?? "Lab Test",
            reportReady: Boolean(row.report_storage_key),
          });
          lastSnapshot.set(row.id, status);
        }
      });

      if (updates.length) {
        sendEvent("lab-order-update", updates);
      }
    };

    const interval = setInterval(poll, 8000);
    await poll();

    request.raw.on("close", () => {
      active = false;
      clearInterval(interval);
    });
  });

  app.post("/backfill-reports", async (_request, reply) => {
    const supabase = requireSupabase(app);
    const labService = buildLabService(app.config);

    const { data, error } = await supabase
      .from("lab_orders")
      .select("id, provider_order_reference, report_storage_key")
      .is("report_storage_key", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      throw new Error(`Failed to fetch pending reports: ${error.message}`);
    }

    const results: Array<{ id: string; status: string; message?: string }> = [];

    for (const row of data ?? []) {
      if (!row.provider_order_reference) {
        results.push({ id: row.id, status: "skipped", message: "Missing provider reference" });
        continue;
      }
      try {
        const providerData = toRecord(await labService.orderStatus(row.provider_order_reference));
        const reportKey =
          getString(providerData, "report_url") ??
          getString(providerData, "digital_report") ??
          getString(providerData, "report_link") ??
          null;
        if (!reportKey) {
          results.push({ id: row.id, status: "no-report" });
          continue;
        }
        const storedKey = await maybePersistReportUrl(app, {
          reportUrl: reportKey,
          existingKey: null,
          orderId: row.id,
        });
        await supabase.from("lab_orders").update({
          report_storage_key: storedKey ?? reportKey,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        results.push({ id: row.id, status: "updated" });
      } catch (err) {
        results.push({ id: row.id, status: "failed", message: err instanceof Error ? err.message : String(err) });
      }
    }

    return reply.send({ status: "ok", data: results });
  });

  app.get(
    "/search-test",
    { schema: searchTestSchema },
    async (request) => {
      const { keyword = "" } = request.query as { keyword?: string };
      const data = await labService.searchTest(keyword);
      return { status: "ok", data };
    }
  );

  app.post(
    "/search-test",
    { schema: searchTestBodySchema },
    async (request) => {
      const { keyword = "" } = request.body as { keyword?: string };
      const data = await labService.searchTest(keyword);
      return { status: "ok", data };
    }
  );

  app.get(
    "/test-description/:testid",
    { schema: testDescriptionSchema },
    async (request) => {
      const { testid } = request.params as { testid: string };
      const data = await labService.testDescription(testid);
      return { status: "ok", data };
    }
  );

  app.post(
    "/test-description",
    { schema: testDescriptionBodySchema },
    async (request) => {
      const { testid } = request.body as { testid: string };
      const data = await labService.testDescription(testid);
      return { status: "ok", data };
    }
  );

  app.get(
    "/get-pincode/:pincode",
    { schema: pincodeSchema },
    async (request) => {
      const { pincode } = request.params as { pincode: string };
      const data = await labService.getPincode(pincode);
      return { status: "ok", data };
    }
  );

  app.get("/get-pincode", { schema: pincodeQuerySchema }, async (request) => {
    const { pincode } = request.query as { pincode: string };
    const data = await labService.getPincode(pincode);
    return { status: "ok", data };
  });

    app.post("/book-order", async (request) => {
      const payload = request.body as Record<string, unknown>;
      let providerData: Record<string, unknown> = {};
      let providerError: string | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const data = await labService.bookOrder(payload);
          providerData = toRecord(data);
          providerError = null;
          break;
        } catch (error) {
          providerError = error instanceof Error ? error.message : String(error);
          if (attempt < 1) {
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }
      if (providerError) {
        providerData = {
          request_status: "manual_pending",
          error: providerError,
          success: "manual",
        };
      }
      const supabase = requireSupabase(app);
      const mongo = requireMongo(app);
      const now = new Date().toISOString();

    const companyId = await ensureCompanyByReference(app, {
      companyReference: typeof payload.companyReference === "string" ? payload.companyReference : undefined,
      companyName: typeof payload.companyName === "string" ? payload.companyName : undefined,
    });

    const employee = await ensureEmployeePrincipal(app, {
      companyId,
      email: typeof payload.email === "string" ? payload.email : undefined,
      phone: typeof payload.mobile === "string" ? payload.mobile : undefined,
      fullName: typeof payload.customer_name === "string" ? payload.customer_name : undefined,
      handle:
        typeof payload.customer_name === "string"
          ? payload.customer_name
          : typeof payload.email === "string"
            ? payload.email
            : undefined,
    });

    const localOrderId = crypto.randomUUID();
    const providerReference =
      getString(providerData, "reference_id") ??
      getString(providerData, "reference") ??
      getString(providerData, "booking_reference") ??
      getString(payload, "reference_id") ??
      localOrderId;
    const providerOrderReference =
      getString(providerData, "order_id") ??
      getString(providerData, "order_no") ??
      getString(payload, "order_id") ??
      providerReference;
    const labTestName =
      getString(payload, "test_name") ??
      getString(payload, "testName") ??
      getString(payload, "test_parameter") ??
      "Lab Test";
    const providerTestCode =
      getString(payload, "test_id") ??
      getString(payload, "testid") ??
      getString(payload, "test_code") ??
      slug(labTestName);
    const priceInr = getNumber(payload, "amount") ?? getNumber(payload, "price") ?? 0;
    const creditCost = getNumber(payload, "creditCost") ?? Math.round(priceInr * 10);
      const providerStatusRaw =
        getString(providerData, "request_status") ??
        getString(providerData, "status") ??
        getString(providerData, "order_status") ??
        getString(providerData, "message");
      const localStatus = normalizeLabStatus(providerStatusRaw);
      const successCode =
        getString(providerData, "success") ??
        getString(providerData, "status_code") ??
        getString(providerData, "code");
      const isSuccess =
        String(successCode ?? "").toLowerCase() === "success" ||
        String(successCode ?? "") === "1" ||
        String(providerStatusRaw ?? "").toLowerCase().includes("success") ||
        String(providerStatusRaw ?? "").toLowerCase().includes("manual");

    let labTestCatalogId = await ensureLabCatalogEntry(supabase, {
      provider: "niramaya",
      providerTestCode,
      name: labTestName,
      basePriceInr: priceInr,
    });

    const { error: orderError } = await supabase.from("lab_orders").insert({
      id: localOrderId,
      company_id: companyId,
      employee_id: employee.userId,
      patient_id: null,
      prescription_id: null,
      lab_test_catalog_id: labTestCatalogId,
      provider: "niramaya",
      provider_order_reference: String(providerOrderReference),
      status: localStatus,
      slot_at: normalizeSlotAt(payload),
      report_storage_key: null,
      credit_cost: creditCost,
      price_inr: priceInr,
      created_at: now,
      updated_at: now,
    });
    if (orderError) {
      throw new Error(`Failed to create local lab order: ${orderError.message}`);
    }

    await supabase.from("lab_order_status_history").insert({
      id: crypto.randomUUID(),
      lab_order_id: localOrderId,
      status: localStatus,
      provider_payload_json: providerData,
      created_at: now,
    });

    await mongo.collection("lab_order_events").insertOne({
      labOrderId: localOrderId,
      providerOrderReference,
      companyId,
      employeeId: employee.userId,
      eventType: "lab_order_created",
      payload: providerData,
      source: "backend-api",
      eventAt: now,
      ingestedAt: now,
      schemaVersion: 1,
    });

    await enqueueOutboxEvent(app, {
      event_type: "lab.order.created",
      aggregate_type: "lab_order",
      aggregate_id: localOrderId,
      payload: {
        companyId,
        employeeId: employee.userId,
        providerOrderReference,
      },
      idempotency_key: `lab-order-created:${localOrderId}`,
    });

      return {
        status: "ok",
        data: {
          ...providerData,
          localOrderId,
          providerReference,
          providerStatus: localStatus,
          success: isSuccess,
          providerError,
        },
      };
    });

  app.get(
    "/order-status/:reference",
    { schema: referenceSchema },
    async (request) => {
      const { reference } = request.params as { reference: string };
      const data = await labService.orderStatus(reference);
      const providerData = toRecord(data);
      const supabase = requireSupabase(app);
      const mongo = requireMongo(app);
      const now = new Date().toISOString();
      const localStatus = normalizeLabStatus(getString(providerData, "request_status") ?? getString(providerData, "status"));
      const reportKey =
        getString(providerData, "report_url") ??
        getString(providerData, "digital_report") ??
        getString(providerData, "report_link") ??
        null;

      const { data: existing } = await supabase
        .from("lab_orders")
        .select("id, report_storage_key")
        .eq("provider_order_reference", reference)
        .maybeSingle();

      if (existing?.id) {
        const storedKey = await maybePersistReportUrl(app, {
          reportUrl: reportKey,
          existingKey: existing.report_storage_key ?? null,
          orderId: existing.id,
        });
        await supabase.from("lab_orders").update({
          status: localStatus,
          report_storage_key: storedKey ?? reportKey ?? undefined,
          updated_at: now,
        }).eq("id", existing.id);

        await supabase.from("lab_order_status_history").insert({
          id: crypto.randomUUID(),
          lab_order_id: existing.id,
          status: localStatus,
          provider_payload_json: providerData,
          created_at: now,
        });

        await mongo.collection("lab_order_events").insertOne({
          labOrderId: existing.id,
          providerOrderReference: reference,
          eventType: "lab_order_status_checked",
          payload: providerData,
          source: "backend-api",
          eventAt: now,
          ingestedAt: now,
          schemaVersion: 1,
        });
      }
      return { status: "ok", data: providerData };
    }
  );

  app.post(
    "/cancel-order",
    { schema: cancelOrderSchema },
    async (request) => {
      const payload = request.body as CancelOrderBody;
      const data = await labService.cancelOrder(payload);
      await syncLabOrderStatus(app, payload.reference, "cancelled", toRecord(data));
      return { status: "ok", data };
    }
  );

  app.post(
    "/reschedule-order",
    { schema: rescheduleOrderSchema },
    async (request) => {
      const payload = request.body as RescheduleOrderBody;
      const data = await labService.rescheduleOrder(payload);
      await syncLabOrderStatus(app, payload.reference, "rescheduled", toRecord(data));
      return { status: "ok", data };
    }
  );

  app.get(
    "/payment-status/:reference",
    { schema: referenceSchema },
    async (request) => {
      const { reference } = request.params as { reference: string };
      const data = await labService.paymentStatus(reference);
      return { status: "ok", data };
    }
  );

  app.post("/payment-link", async (request) => {
    const payload = request.body as Record<string, unknown>;
    const data = await labService.paymentLink(payload);
    return { status: "ok", data };
  });

  app.post(
    "/send-notification",
    { schema: sendNotificationSchema },
    async (request, reply) => {
      const payload = request.body as {
        authorization: string;
        order_id: string | number;
        reference_id: string | number;
        request_status: string;
      };

      if (payload.authorization.trim() !== app.config.NIRAMAYA_AUTH) {
        return reply.code(401).send({
          status: "error",
          message: "Invalid notification authorization",
        });
      }

      const providerData = toRecord(payload);
      const localStatus = normalizeLabStatus(payload.request_status);
      const reportKey =
        getString(providerData, "report_url") ??
        getString(providerData, "digital_report") ??
        getString(providerData, "report_link") ??
        null;
      const supabase = requireSupabase(app);
      const mongo = requireMongo(app);
      const now = new Date().toISOString();

      const { data: existing } = await supabase
        .from("lab_orders")
        .select("id, report_storage_key")
        .eq("provider_order_reference", String(payload.reference_id))
        .maybeSingle();

      if (existing?.id) {
        const storedKey = await maybePersistReportUrl(app, {
          reportUrl: reportKey,
          existingKey: existing.report_storage_key ?? null,
          orderId: existing.id,
        });
        await supabase.from("lab_orders").update({
          status: localStatus,
          report_storage_key: storedKey ?? reportKey ?? undefined,
          updated_at: now,
        }).eq("id", existing.id);

        await supabase.from("lab_order_status_history").insert({
          id: crypto.randomUUID(),
          lab_order_id: existing.id,
          status: localStatus,
          provider_payload_json: providerData,
          created_at: now,
        });

        await mongo.collection("lab_order_events").insertOne({
          labOrderId: existing.id,
          providerOrderReference: String(payload.reference_id),
          eventType: "lab_order_notification",
          payload: providerData,
          source: "niramaya-webhook",
          eventAt: now,
          ingestedAt: now,
          schemaVersion: 1,
        });
      }

      app.log.info(
        {
          order_id: payload.order_id,
          reference_id: payload.reference_id,
          request_status: payload.request_status,
        },
        "Niramaya notification received"
      );

      return { status: "ok", message: "Notification accepted" };
    }
  );
};

async function ensureLabCatalogEntry(
  supabase: ReturnType<typeof requireSupabase>,
  input: {
    provider: string;
    providerTestCode: string;
    name: string;
    basePriceInr: number;
  }
) {
  const { data: existing } = await supabase
    .from("lab_test_catalog")
    .select("id")
    .eq("provider", input.provider)
    .eq("provider_test_code", input.providerTestCode)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const labTestCatalogId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("lab_test_catalog")
    .upsert(
      {
        id: labTestCatalogId,
        provider: input.provider,
        provider_test_code: input.providerTestCode,
        name: input.name,
        category: "General Test",
        sample_type: null,
        tat_hours: null,
        base_price_inr: input.basePriceInr,
        default_credit_cost: Math.round(input.basePriceInr * 10),
        availability_status: "live",
        coverage_note: null,
        metadata_json: {},
        created_at: now,
        updated_at: now,
      },
      {
        onConflict: "provider,provider_test_code",
      }
    )
    .select("id")
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const { data: existingAfter } = await supabase
        .from("lab_test_catalog")
        .select("id")
        .eq("provider", input.provider)
        .eq("provider_test_code", input.providerTestCode)
        .maybeSingle();
      if (existingAfter?.id) return existingAfter.id;
    }
    throw new Error(`Failed to ensure lab test catalog entry: ${error.message}`);
  }

  if (data?.id) return data.id;
  return labTestCatalogId;
}

function getString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function getNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSlotAt(payload: Record<string, unknown>) {
  const date = getString(payload, "date");
  const time = getString(payload, "time");
  if (!date) return null;
  const candidate = time ? `${date} ${time}` : date;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeLabStatus(input: string | null) {
  const status = input?.toLowerCase() ?? "";
  if (status.includes("resched")) return "rescheduled";
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("process")) return "processing";
  if (status.includes("sample")) return "sample_collection";
  if (status.includes("complete")) return "completed";
  if (status.includes("schedule")) return "scheduled";
  return "created";
}

function slug(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function maybePersistReportUrl(
  app: Parameters<FastifyPluginAsync>[0],
  input: {
    reportUrl: string | null;
    existingKey: string | null;
    orderId: string;
  }
) {
  if (!input.reportUrl) return null;
  if (input.existingKey && !input.existingKey.startsWith("http")) {
    return input.existingKey;
  }

  try {
    const response = await fetch(input.reportUrl);
    if (!response.ok || !response.body) {
      return input.reportUrl;
    }
    const contentType = response.headers.get("content-type") ?? "application/pdf";
    const bucket = requireMongoBucket(app);
    const fileName = `lab-reports/${input.orderId}/${Date.now()}.pdf`;
    const uploadStream = bucket.openUploadStream(fileName, {
      contentType,
      metadata: {
        source: "niramaya",
        orderId: input.orderId,
        reportUrl: input.reportUrl,
      },
    });
    await pipeline(Readable.fromWeb(response.body as unknown as ReadableStream), uploadStream);
    return uploadStream.id?.toString() ?? fileName;
  } catch {
    return input.reportUrl;
  }
}

async function syncLabOrderStatus(
  app: Parameters<FastifyPluginAsync>[0],
  reference: string,
  status: "cancelled" | "rescheduled",
  providerPayload: Record<string, unknown>
) {
  const supabase = requireSupabase(app);
  const mongo = requireMongo(app);
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("lab_orders")
    .select("id")
    .eq("provider_order_reference", reference)
    .maybeSingle();

  if (!existing?.id) return;

  await supabase.from("lab_orders").update({
    status,
    updated_at: now,
  }).eq("id", existing.id);

  await supabase.from("lab_order_status_history").insert({
    id: crypto.randomUUID(),
    lab_order_id: existing.id,
    status,
    provider_payload_json: providerPayload,
    created_at: now,
  });

  await mongo.collection("lab_order_events").insertOne({
    labOrderId: existing.id,
    providerOrderReference: reference,
    eventType: `lab_order_${status}`,
    payload: providerPayload,
    source: "backend-api",
    eventAt: now,
    ingestedAt: now,
    schemaVersion: 1,
  });
}

export default labRoutes;
