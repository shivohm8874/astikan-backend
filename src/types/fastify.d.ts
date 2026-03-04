import "fastify";

import type { AppEnv } from "../config/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db, GridFSBucket } from "mongodb";

declare module "fastify" {
  interface FastifyInstance {
    config: AppEnv;
    dbClients: {
      supabase: SupabaseClient | null;
      mongo: Db | null;
      mongoBucket: GridFSBucket | null;
    };
  }
}
