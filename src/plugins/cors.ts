import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";

const corsPlugin: FastifyPluginAsync = async (app) => {
  const rawOrigin = app.hasDecorator("config")
    ? app.config.CORS_ORIGIN
    : process.env.CORS_ORIGIN ?? "";
  const trimmed = rawOrigin.trim();
  const fallback = "*";
  const configuredOrigins = (trimmed || fallback).split(",").map((origin) => origin.trim()).filter(Boolean);
  const hasWildcard = configuredOrigins.some((origin) => origin === "*" || origin.includes("*"));
  const origin = hasWildcard ? true : configuredOrigins;

  await app.register(cors, {
    origin,
    credentials: true,
  });

  app.options("/*", async (_request, reply) => {
    reply.status(204).send();
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (!reply.getHeader("access-control-allow-origin")) {
      const reqOrigin = request.headers.origin;
      reply.header("Access-Control-Allow-Origin", reqOrigin ?? "*");
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
      );
      reply.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
    }
    return payload;
  });
};

export default corsPlugin;
