import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { enqueueOutboxEvent, requireSupabase } from "../core/data";

const companiesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (request) => {
    const body = request.body as {
      name: string;
      email?: string;
      contact_name?: string;
      employee_count?: number;
      plan?: string;
      requested_credits?: number;
      metadata?: Record<string, unknown>;
    };

    const supabase = requireSupabase(app);
    const companyId = crypto.randomUUID();

    const now = new Date().toISOString();
    const { error: companyError } = await supabase.from("companies").insert({
      id: companyId,
      name: body.name,
      email: body.email ?? null,
      contact_name: body.contact_name ?? null,
      employee_count: body.employee_count ?? 0,
      plan: body.plan ?? "starter",
      status: "pending",
      metadata_json: body.metadata ?? {},
      created_at: now,
      updated_at: now,
    });

    if (companyError) {
      throw new Error(`Failed to create company registration: ${companyError.message}`);
    }

    const { error: walletError } = await supabase.from("company_credit_wallets").insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      balance: 0,
      credit_limit: 0,
      billing_cycle: "monthly",
      created_at: now,
      updated_at: now,
    });

    if (walletError) {
      throw new Error(`Failed to initialize company wallet: ${walletError.message}`);
    }

    await enqueueOutboxEvent(app, {
      event_type: "company.registered",
      aggregate_type: "company",
      aggregate_id: companyId,
      payload: {
        companyId,
        name: body.name,
        requestedCredits: body.requested_credits ?? 0,
      },
    });

    return {
      status: "ok",
      data: {
        companyId,
        registrationStatus: "pending",
      },
    };
  });
};

export default companiesRoutes;
