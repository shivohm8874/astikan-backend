import fastifyEnv from "@fastify/env";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export type AppEnv = {
  PORT: number;
  CORS_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MONGODB_URI: string;
  MONGODB_DB_NAME: string;
  REDIS_URL: string;
  REDIS_TTL_SECONDS: number;
  OPENWEATHER_API_KEY: string;
  NIRAMAYA_TEST_URL: string;
  NIRAMAYA_PROD_URL: string;
  NIRAMAYA_PINCODE_URL: string;
  NIRAMAYA_AUTH: string;
  NIRAMAYA_ALLOW_INSECURE_TLS: boolean;
  GROK_API_KEY: string;
  GROK_BASE_URL: string;
  GROK_MODEL: string;
  ZEGO_APP_ID: string;
  ZEGO_SERVER_SECRET: string;
  AGORA_APP_ID: string;
  AGORA_APP_CERTIFICATE: string;
};

const envSchema = {
  type: "object",
  required: ["PORT", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  properties: {
    PORT: { type: "number", default: 4000 },
    CORS_ORIGIN: { type: "string", default: "*" },
    SUPABASE_URL: { type: "string", default: "" },
    SUPABASE_SERVICE_ROLE_KEY: { type: "string", default: "" },
    MONGODB_URI: { type: "string", default: "" },
    MONGODB_DB_NAME: { type: "string", default: "astikan" },
    REDIS_URL: { type: "string", default: "" },
    REDIS_TTL_SECONDS: { type: "number", default: 600 },
    OPENWEATHER_API_KEY: { type: "string", default: "" },
    NIRAMAYA_TEST_URL: {
      type: "string",
      default: "https://test.niramayahealthcare.com/api",
    },
    NIRAMAYA_PROD_URL: {
      type: "string",
      default: "https://www.niramayahealthcare.com/api",
    },
    NIRAMAYA_PINCODE_URL: {
      type: "string",
      default: "http://test.niramayahealthcare.com/api",
    },
    NIRAMAYA_AUTH: { type: "string", minLength: 1 },
    NIRAMAYA_ALLOW_INSECURE_TLS: { type: "boolean", default: false },
    GROK_API_KEY: { type: "string", default: "" },
    GROK_BASE_URL: { type: "string", default: "https://api.x.ai/v1" },
    GROK_MODEL: { type: "string", default: "grok-4-1-fast-reasoning" },
    ZEGO_APP_ID: { type: "string", default: "" },
    ZEGO_SERVER_SECRET: { type: "string", default: "" },
    AGORA_APP_ID: { type: "string", default: "" },
    AGORA_APP_CERTIFICATE: { type: "string", default: "" },
  },
  additionalProperties: true,
} as const;

const envPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyEnv, {
    confKey: "config",
    schema: envSchema,
    dotenv: true,
    data: process.env,
  });
};

export default fp(envPlugin);
