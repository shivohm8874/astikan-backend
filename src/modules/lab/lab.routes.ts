import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";

import { enqueueOutboxEvent, requireMongo, requireSupabase } from "../core/data";
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
    const data = await labService.bookOrder(payload);
    const providerData = toRecord(data);
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
      String(providerStatusRaw ?? "").toLowerCase().includes("success");

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

      const { data: existing } = await supabase
        .from("lab_orders")
        .select("id")
        .eq("provider_order_reference", reference)
        .maybeSingle();

      if (existing?.id) {
        await supabase.from("lab_orders").update({
          status: localStatus,
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
      const supabase = requireSupabase(app);
      const mongo = requireMongo(app);
      const now = new Date().toISOString();

      const { data: existing } = await supabase
        .from("lab_orders")
        .select("id")
        .eq("provider_order_reference", String(payload.reference_id))
        .maybeSingle();

      if (existing?.id) {
        await supabase.from("lab_orders").update({
          status: localStatus,
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
  const { error } = await supabase.from("lab_test_catalog").insert({
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
  });
  if (error) {
    throw new Error(`Failed to ensure lab test catalog entry: ${error.message}`);
  }
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
