import type { FastifyPluginAsync } from "fastify";
import aiRoutes from "./modules/ai/ai.routes";
import companiesRoutes from "./modules/companies/companies.routes";
import creditsRoutes from "./modules/credits/credits.routes";
import healthRoutes from "./modules/health/health.routes";
import labRoutes from "./modules/lab/lab.routes";
import teleconsultRoutes from "./modules/teleconsult/teleconsult.routes";

const routes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(aiRoutes, { prefix: "/ai" });
  await app.register(labRoutes, { prefix: "/lab" });
  await app.register(companiesRoutes, { prefix: "/companies" });
  await app.register(creditsRoutes, { prefix: "/credits" });
  await app.register(teleconsultRoutes, { prefix: "/teleconsult" });
};

export default routes;
