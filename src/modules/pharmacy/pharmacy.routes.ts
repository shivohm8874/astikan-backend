import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { enqueueOutboxEvent, requireMongo, requireSupabase } from "../core/data";
import { ensureCompanyByReference, ensureDoctorPrincipal, ensureEmployeePrincipal } from "../core/identity";

const pharmacyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/products", async (request) => {
    const query = request.query as { search?: string; category?: string; limit?: string; audience?: string };
    const supabase = requireSupabase(app);
    const limit = query.limit ? Number(query.limit) : 50;
    let dbQuery = supabase
      .from("pharmacy_product_catalog")
      .select("id, sku, name, category, description, base_price_inr, image_urls_json, is_active, audience")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(Number.isFinite(limit) ? limit : 50);

    if (query.category) {
      dbQuery = dbQuery.eq("category", query.category);
    }
    if (query.search) {
      dbQuery = dbQuery.ilike("name", `%${query.search}%`);
    }
    if (query.audience) {
      dbQuery = dbQuery.eq("audience", query.audience);
    }

    const { data, error } = await dbQuery;
    if (error) {
      throw new Error(`Failed to fetch products: ${error.message}`);
    }

    const enriched = await attachInventorySnapshot(supabase, data ?? []);
    return { status: "ok", data: enriched };
  });

  app.post("/products/lookup", async (request) => {
    const body = request.body as { ids?: string[]; audience?: string };
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    if (!ids.length) {
      return { status: "ok", data: [] };
    }

    const supabase = requireSupabase(app);
    let dbQuery = supabase
      .from("pharmacy_product_catalog")
      .select("id, sku, name, category, description, base_price_inr, image_urls_json, is_active, audience")
      .in("id", ids);

    if (body.audience) {
      dbQuery = dbQuery.eq("audience", body.audience);
    }

    const { data, error } = await dbQuery;

    if (error) {
      throw new Error(`Failed to lookup products: ${error.message}`);
    }

    const enriched = await attachInventorySnapshot(supabase, data ?? []);
    return { status: "ok", data: enriched };
  });

  app.get("/categories", async (request) => {
    const query = request.query as { audience?: string };
    const supabase = requireSupabase(app);
    let dbQuery = supabase
      .from("pharmacy_product_catalog")
      .select("category")
      .eq("is_active", true);

    if (query.audience) {
      dbQuery = dbQuery.eq("audience", query.audience);
    }

    const { data, error } = await dbQuery;

    if (error) {
      throw new Error(`Failed to fetch categories: ${error.message}`);
    }

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const key = row.category ?? "Other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const payload = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { status: "ok", data: payload };
  });

  app.post("/orders", async (request) => {
    const body = request.body as {
      companyReference?: string;
      companyName?: string;
      doctor?: { email?: string; phone?: string; fullName?: string; handle?: string };
      employee?: { email?: string; phone?: string; fullName?: string; handle?: string; employeeCode?: string };
      patientId?: string;
      orderSource: "doctor_store" | "employee_store" | "admin_panel";
      status?: "cart" | "placed" | "paid" | "packed" | "shipped" | "delivered" | "cancelled" | "refunded";
      subtotalInr: number;
      walletUsedInr?: number;
      onlinePaymentInr?: number;
      creditCost?: number;
      shippingAddress?: Record<string, unknown>;
      items: Array<{
        sku?: string;
        productId?: string;
        name: string;
        category?: string;
        description?: string;
        price: number;
        quantity: number;
        imageUrls?: string[];
      }>;
    };

    if (!Array.isArray(body.items) || !body.items.length) {
      throw new Error("At least one pharmacy order item is required");
    }

    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);
    const now = new Date().toISOString();
    const companyId = await ensureCompanyByReference(app, {
      companyReference: body.companyReference,
      companyName: body.companyName,
    });

    const doctor = body.doctor ? await ensureDoctorPrincipal(app, body.doctor) : null;
    const employee = body.employee
      ? await ensureEmployeePrincipal(app, {
          companyId,
          ...body.employee,
        })
      : null;

    const orderId = crypto.randomUUID();
    const { error: orderError } = await supabase.from("pharmacy_orders").insert({
      id: orderId,
      company_id: companyId,
      doctor_id: doctor?.userId ?? null,
      employee_id: employee?.userId ?? null,
      patient_id: body.patientId ?? null,
      order_source: body.orderSource,
      status: body.status ?? "placed",
      subtotal_inr: body.subtotalInr,
      wallet_used_inr: body.walletUsedInr ?? 0,
      online_payment_inr: body.onlinePaymentInr ?? body.subtotalInr,
      credit_cost: body.creditCost ?? null,
      shipping_address_json: body.shippingAddress ?? {},
      created_at: now,
      updated_at: now,
    });
    if (orderError) {
      throw new Error(`Failed to create pharmacy order: ${orderError.message}`);
    }

    for (const item of body.items) {
      let productId = item.productId ?? "";
      if (!productId) {
        productId = crypto.randomUUID();
        const audience = body.orderSource === "doctor_store" ? "doctor" : "employee";
        await supabase.from("pharmacy_product_catalog").upsert({
          id: productId,
          sku: item.sku ?? `SKU-${slug(item.name)}`,
          name: item.name,
          category: item.category ?? null,
          description: item.description ?? null,
          base_price_inr: item.price,
          image_urls_json: item.imageUrls ?? [],
          is_active: true,
          audience,
          updated_at: now,
        });
      }

      await supabase.from("pharmacy_order_items").insert({
        id: crypto.randomUUID(),
        order_id: orderId,
        product_id: productId,
        qty: item.quantity,
        unit_price_inr: item.price,
        line_total_inr: item.price * item.quantity,
        created_at: now,
      });
    }

    await mongo.collection("pharmacy_order_events").insertOne({
      orderId,
      companyId,
      employeeId: employee?.userId ?? null,
      doctorId: doctor?.userId ?? null,
      eventType: "pharmacy_order_created",
      payload: {
        orderSource: body.orderSource,
        itemCount: body.items.length,
        subtotalInr: body.subtotalInr,
      },
      source: "backend-api",
      eventAt: now,
      ingestedAt: now,
      schemaVersion: 1,
    });

    await enqueueOutboxEvent(app, {
      event_type: "pharmacy.order.created",
      aggregate_type: "pharmacy_order",
      aggregate_id: orderId,
      payload: {
        companyId,
        employeeId: employee?.userId ?? null,
        doctorId: doctor?.userId ?? null,
        orderSource: body.orderSource,
      },
      idempotency_key: `pharmacy-order-created:${orderId}`,
    });

    return { status: "ok", data: { orderId, companyId } };
  });
};

async function attachInventorySnapshot(
  supabase: ReturnType<typeof requireSupabase>,
  products: Array<{
    id: string;
    sku?: string | null;
    name: string;
    category?: string | null;
    description?: string | null;
    base_price_inr: number;
    image_urls_json?: string[];
    is_active?: boolean;
  }>
) {
  if (!products.length) return [];

  const ids = products.map((item) => item.id);
  const { data: inventory } = await supabase
    .from("pharmacy_inventory")
    .select("product_id, available_qty, reserved_qty")
    .in("product_id", ids);

  const inventoryMap = new Map<string, { available_qty: number; reserved_qty: number }>();
  for (const row of inventory ?? []) {
    inventoryMap.set(row.product_id, {
      available_qty: row.available_qty ?? 0,
      reserved_qty: row.reserved_qty ?? 0,
    });
  }

  return products.map((item) => {
    const inv = inventoryMap.get(item.id);
    const available = inv ? Math.max((inv.available_qty ?? 0) - (inv.reserved_qty ?? 0), 0) : null;
    return {
      ...item,
      available_qty: available,
      in_stock: available === null ? Boolean(item.is_active) : available > 0,
    };
  });
}

function slug(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default pharmacyRoutes;
