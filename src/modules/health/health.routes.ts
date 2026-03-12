import crypto from "node:crypto"
import { FastifyInstance } from "fastify"
import { requireSupabase } from "../core/data"

export default async function healthRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    return { status: "ok", service: "Astikan backend" }
  })

  app.post("/metrics", async (request) => {
    const body = request.body as {
      companyId?: string
      employeeId?: string
      heightCm?: number
      weightKg?: number
      waistCm?: number
    }

    if (!body.companyId || !body.employeeId) {
      throw new Error("companyId and employeeId are required")
    }

    const supabase = requireSupabase(app)
    const now = new Date().toISOString()
    const { data: existing } = await supabase
      .from("employee_health_metrics")
      .select("id")
      .eq("employee_id", body.employeeId)
      .maybeSingle()

    const payload = {
      id: existing?.id ?? crypto.randomUUID(),
      company_id: body.companyId,
      employee_id: body.employeeId,
      height_cm: typeof body.heightCm === "number" ? body.heightCm : null,
      weight_kg: typeof body.weightKg === "number" ? body.weightKg : null,
      waist_cm: typeof body.waistCm === "number" ? body.waistCm : null,
      updated_at: now,
    }

    const { error } = await supabase.from("employee_health_metrics").upsert(payload)
    if (error) {
      throw new Error(`Failed to save health metrics: ${error.message}`)
    }

    return { status: "ok", data: { employeeId: body.employeeId } }
  })
}
