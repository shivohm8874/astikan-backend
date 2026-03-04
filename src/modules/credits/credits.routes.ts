import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { enqueueOutboxEvent, requireSupabase } from "../core/data";

const creditsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/purchase", async (request) => {
    const body = request.body as {
      companyId: string;
      amount: number;
      currency?: string;
      reference?: string;
    };

    if (!body.companyId || !Number.isFinite(body.amount) || body.amount <= 0) {
      throw new Error("Invalid companyId or amount");
    }

    const supabase = requireSupabase(app);
    const now = new Date().toISOString();

    const { data: wallet, error: walletReadError } = await supabase
      .from("company_credit_wallets")
      .select("*")
      .eq("company_id", body.companyId)
      .maybeSingle();

    if (walletReadError || !wallet) {
      throw new Error("Company wallet not found");
    }

    const nextBalance = Number(wallet.balance ?? 0) + body.amount;

    const { error: walletUpdateError } = await supabase
      .from("company_credit_wallets")
      .update({ balance: nextBalance, updated_at: now })
      .eq("id", wallet.id);

    if (walletUpdateError) {
      throw new Error(`Failed to update wallet: ${walletUpdateError.message}`);
    }

    const { error: ledgerError } = await supabase.from("company_credit_ledger").insert({
      id: crypto.randomUUID(),
      company_id: body.companyId,
      amount: body.amount,
      currency: body.currency ?? "INR",
      entry_type: "credit",
      reason: "purchase",
      reference: body.reference ?? null,
      created_at: now,
    });

    if (ledgerError) {
      throw new Error(`Failed to insert credit ledger entry: ${ledgerError.message}`);
    }

    await enqueueOutboxEvent(app, {
      event_type: "credits.purchased",
      aggregate_type: "company_wallet",
      aggregate_id: wallet.id,
      payload: {
        companyId: body.companyId,
        amount: body.amount,
        balance: nextBalance,
      },
    });

    return {
      status: "ok",
      data: {
        companyId: body.companyId,
        newBalance: nextBalance,
      },
    };
  });
};

export default creditsRoutes;
