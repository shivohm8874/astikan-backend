import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { requireSupabase } from "../core/data";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function hashPassword(password: string, saltHex: string) {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function verifyPassword(password: string, storedHash: string) {
  const [scheme, saltHex, digestHex] = storedHash.split("$");
  if (scheme !== "scrypt" || !saltHex || !digestHex) {
    return false;
  }
  const actual = hashPassword(password, saltHex);
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(digestHex, "hex"));
}

function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = hashPassword(password, salt);
  return `scrypt$${salt}$${digest}`;
}

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/employee/company-authorize", async (request, reply) => {
    const body = request.body as { companyCode?: string };
    const companyCode = normalize(body.companyCode ?? "");
    if (!companyCode) {
      return reply.code(400).send({ status: "error", message: "Company code is required." });
    }

    const supabase = requireSupabase(app);
    const { data: accessCode, error } = await supabase
      .from("company_access_codes")
      .select("company_id, code, label, companies(id, name, slug, contact_phone, metadata_json)")
      .eq("code_type", "employee_app")
      .eq("code", companyCode.toUpperCase())
      .maybeSingle();

    if (error) {
      return reply.code(500).send({ status: "error", message: error.message });
    }
    if (!accessCode) {
      return reply.code(404).send({ status: "error", message: "Company code not found." });
    }

    const company = (accessCode as any).companies ?? null;
    const hrPhone = company?.contact_phone ?? company?.metadata_json?.hr_phone ?? null;

    return {
      status: "ok",
      data: {
        companyId: accessCode.company_id,
        companyCode: accessCode.code,
        companyName: company?.name ?? accessCode.label ?? "Company",
        companySlug: company?.slug ?? null,
        hrPhone,
      },
    };
  });

  app.post("/corporate/authorize", async (request, reply) => {
    const body = request.body as { corporateId?: string };
    const corporateId = normalize(body.corporateId ?? "");
    if (!corporateId) {
      return reply.code(400).send({ status: "error", message: "Corporate ID is required." });
    }

    const supabase = requireSupabase(app);
    const { data: accessCode, error } = await supabase
      .from("company_access_codes")
      .select("company_id, code, label, companies(id, name, slug)")
      .eq("code_type", "corporate_portal")
      .eq("code", corporateId.toUpperCase())
      .maybeSingle();

    if (error) {
      return reply.code(500).send({ status: "error", message: error.message });
    }
    if (!accessCode) {
      return reply.code(404).send({ status: "error", message: "Corporate ID not found." });
    }

    return {
      status: "ok",
      data: {
        companyId: accessCode.company_id,
        corporateId: accessCode.code,
        companyName: (accessCode as any).companies?.name ?? accessCode.label ?? "Company",
        companySlug: (accessCode as any).companies?.slug ?? null,
      },
    };
  });

  async function findLoginAccount(identifierType: "email" | "mobile" | "username", identifier: string, role?: string, companyId?: string) {
    const supabase = requireSupabase(app);
    let query = supabase
      .from("login_accounts")
      .select("user_id, company_id, role, identifier, password_hash, status")
      .eq("identifier_type", identifierType)
      .eq("identifier", identifier)
      .eq("status", "active");

    if (role) query = query.eq("role", role);
    if (companyId) query = query.eq("company_id", companyId);

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    return data;
  }

  async function buildUserPayload(userId: string, companyId?: string | null) {
    const supabase = requireSupabase(app);
    const { data: user } = await supabase
      .from("app_users")
      .select("id, primary_role, full_name, email, phone, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    let company = null;
    if (companyId) {
      const { data } = await supabase
        .from("companies")
        .select("id, name, slug")
        .eq("id", companyId)
        .maybeSingle();
      company = data ?? null;
    }

    return {
      userId,
      role: user?.primary_role ?? null,
      fullName: user?.full_name ?? null,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      avatarUrl: user?.avatar_url ?? null,
      companyId: company?.id ?? companyId ?? null,
      companyName: company?.name ?? null,
      companySlug: company?.slug ?? null,
    };
  }

  async function ensureSuperAdminSeed(username: string) {
    const seedUsername = (app.config.SUPERADMIN_SEED_USERNAME || "superadmin").trim().toLowerCase();
    if (username !== seedUsername) return;

    const supabase = requireSupabase(app);
    const { data: existing } = await supabase
      .from("login_accounts")
      .select("id")
      .eq("identifier_type", "username")
      .eq("identifier", seedUsername)
      .eq("role", "super_admin")
      .maybeSingle();

    if (existing?.id) return;

    const seedEmail = (app.config.SUPERADMIN_SEED_EMAIL || "superadmin@astikan.local").trim().toLowerCase();
    const seedPassword = app.config.SUPERADMIN_SEED_PASSWORD || "Astikan@2026";

    let userId: string | null = null;
    try {
      const created = await supabase.auth.admin.createUser({
        email: seedEmail,
        email_confirm: true,
        user_metadata: { full_name: "Astikan Super Admin" },
      });
      userId = created.data.user?.id ?? null;
    } catch {
      userId = null;
    }

    if (!userId) {
      const { data: fallbackUser } = await supabase
        .from("app_users")
        .select("id")
        .eq("email", seedEmail)
        .maybeSingle();
      userId = fallbackUser?.id ?? null;
    }

    if (!userId) {
      throw new Error("Unable to bootstrap super admin user");
    }

    await supabase.from("app_users").upsert({
      id: userId,
      primary_role: "super_admin",
      full_name: "Astikan Super Admin",
      email: seedEmail,
      status: "active",
      updated_at: new Date().toISOString(),
    });

    await supabase.from("user_roles").upsert({
      user_id: userId,
      role: "super_admin",
      company_id: null,
      is_primary: true,
    });

    await supabase.from("login_accounts").upsert({
      user_id: userId,
      company_id: null,
      role: "super_admin",
      identifier_type: "username",
      identifier: seedUsername,
      password_hash: createPasswordHash(seedPassword),
      status: "active",
    });
  }

  app.post("/employee/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    const email = normalize(body.email ?? "");
    const password = body.password ?? "";
    if (!email || !password) {
      return reply.code(400).send({ status: "error", message: "Email and password are required." });
    }

    const account = await findLoginAccount("email", email, "employee");
    if (!account || !verifyPassword(password, account.password_hash)) {
      return reply.code(401).send({ status: "error", message: "Invalid employee credentials." });
    }

    return { status: "ok", data: await buildUserPayload(account.user_id, account.company_id) };
  });

  app.post("/doctor/login", async (request, reply) => {
    const body = request.body as { mobile?: string; password?: string };
    const mobile = (body.mobile ?? "").trim();
    const password = body.password ?? "";
    if (!mobile || !password) {
      return reply.code(400).send({ status: "error", message: "Mobile and password are required." });
    }

    const account = await findLoginAccount("mobile", mobile, "doctor");
    if (!account || !verifyPassword(password, account.password_hash)) {
      return reply.code(401).send({ status: "error", message: "Invalid doctor credentials." });
    }

    return { status: "ok", data: await buildUserPayload(account.user_id, account.company_id) };
  });

  app.post("/corporate/login", async (request, reply) => {
    const body = request.body as { corporateId?: string; username?: string; password?: string };
    const corporateId = normalize(body.corporateId ?? "").toUpperCase();
    const username = normalize(body.username ?? "");
    const password = body.password ?? "";
    if (!corporateId || !username || !password) {
      return reply.code(400).send({ status: "error", message: "Corporate ID, username, and password are required." });
    }

    const supabase = requireSupabase(app);
    const { data: accessCode } = await supabase
      .from("company_access_codes")
      .select("company_id")
      .eq("code_type", "corporate_portal")
      .eq("code", corporateId)
      .maybeSingle();

    if (!accessCode?.company_id) {
      return reply.code(404).send({ status: "error", message: "Corporate ID not found." });
    }

    const account = await findLoginAccount("username", username, "corporate_admin", accessCode.company_id);
    if (!account || !verifyPassword(password, account.password_hash)) {
      return reply.code(401).send({ status: "error", message: "Invalid corporate credentials." });
    }

    return { status: "ok", data: await buildUserPayload(account.user_id, account.company_id) };
  });

  app.post("/superadmin/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    const username = normalize(body.username ?? "");
    const password = body.password ?? "";
    if (!username || !password) {
      return reply.code(400).send({ status: "error", message: "Username and password are required." });
    }

    try {
      await ensureSuperAdminSeed(username);
    } catch (error) {
      app.log.warn({ error }, "Super admin seed failed");
    }

    const account = await findLoginAccount("username", username, "super_admin");
    if (!account || !verifyPassword(password, account.password_hash)) {
      return reply.code(401).send({ status: "error", message: "Invalid super admin credentials." });
    }

    return { status: "ok", data: await buildUserPayload(account.user_id, account.company_id) };
  });
};

export default authRoutes;
