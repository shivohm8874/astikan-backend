import type { FastifyPluginAsync } from "fastify";
import { ensureCompanyByReference, ensureEmployeePrincipal } from "../core/identity";
import { requireSupabase } from "../core/data";

const employeesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/bootstrap", async (request) => {
    const body = request.body as {
      companyReference?: string;
      companyName?: string;
      email?: string;
      phone?: string;
      fullName?: string;
      handle?: string;
      employeeCode?: string;
    };

    const companyId = await ensureCompanyByReference(app, {
      companyReference: body.companyReference,
      companyName: body.companyName,
    });

    const employee = await ensureEmployeePrincipal(app, {
      companyId,
      email: body.email,
      phone: body.phone,
      fullName: body.fullName,
      handle: body.handle,
      employeeCode: body.employeeCode,
    });

    return {
      status: "ok",
      data: {
        companyId,
        employeeUserId: employee.userId,
        employeeCode: employee.employeeCode,
        email: employee.email,
      },
    };
  });

  app.get("/profile/:userId", async (request) => {
    const { userId } = request.params as { userId: string };
    if (!userId) {
      return { status: "error", message: "Missing userId" };
    }

    const supabase = requireSupabase(app);
    const { data, error } = await supabase
      .from("employee_profiles")
      .select("user_id, employee_code, department, designation, address_json")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch employee profile: ${error.message}`);
    }

    return {
      status: "ok",
      data: data ?? null,
    };
  });
};

export default employeesRoutes;
