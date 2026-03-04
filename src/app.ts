import Fastify from "fastify";

import dbPlugin from "./config/db";
import envPlugin from "./config/env";
import outboxWorkerPlugin from "./plugins/outbox-worker";
import corsPlugin from "./plugins/cors";
import routes from "./routes";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get("/", async () => ({
    status: "ok",
    service: "Astikan backend",
    docsBase: "/api",
  }));

  app.register(envPlugin);
  app.register(dbPlugin);
  app.register(outboxWorkerPlugin);
  app.register(corsPlugin);
  app.register(routes, { prefix: "/api" });

  return app;
}
