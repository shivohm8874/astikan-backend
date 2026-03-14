import type { FastifyPluginAsync } from "fastify";
import aiRoutes from "./modules/ai/ai.routes";
import appointmentsRoutes from "./modules/appointments/appointments.routes";
import authRoutes from "./modules/auth/auth.routes";
import behaviorRoutes from "./modules/behavior/behavior.routes";
import companiesRoutes from "./modules/companies/companies.routes";
import creditsRoutes from "./modules/credits/credits.routes";
import doctorsRoutes from "./modules/doctors/doctors.routes";
import employeesRoutes from "./modules/employees/employees.routes";
import healthRoutes from "./modules/health/health.routes";
import integrationsRoutes from "./modules/integrations/integrations.routes";
import labRoutes from "./modules/lab/lab.routes";
import logsRoutes from "./modules/logs/logs.routes";
import pharmacyRoutes from "./modules/pharmacy/pharmacy.routes";
import teleconsultRoutes from "./modules/teleconsult/teleconsult.routes";

const routes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(aiRoutes, { prefix: "/ai" });
  await app.register(behaviorRoutes, { prefix: "/behavior" });
  await app.register(employeesRoutes, { prefix: "/employees" });
  await app.register(doctorsRoutes, { prefix: "/doctors" });
  await app.register(appointmentsRoutes, { prefix: "/appointments" });
  await app.register(logsRoutes, { prefix: "/logs" });
  await app.register(integrationsRoutes, { prefix: "/integrations" });
  await app.register(labRoutes, { prefix: "/lab" });
  await app.register(pharmacyRoutes, { prefix: "/pharmacy" });
  await app.register(companiesRoutes, { prefix: "/companies" });
  await app.register(creditsRoutes, { prefix: "/credits" });
  await app.register(teleconsultRoutes, { prefix: "/teleconsult" });
};

export default routes;
