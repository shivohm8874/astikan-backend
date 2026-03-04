import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";

const corsPlugin: FastifyPluginAsync = async (app) => {
  const rawOrigin = app.hasDecorator("config")
    ? app.config.CORS_ORIGIN
    : process.env.CORS_ORIGIN ?? "http://localhost:5173";
  const configuredOrigins = rawOrigin.split(",").map((origin) => origin.trim());
  const origin = configuredOrigins.includes("*") ? true : configuredOrigins;

  await app.register(cors, {
    origin,
    credentials: true,
  });
};

export default corsPlugin;
