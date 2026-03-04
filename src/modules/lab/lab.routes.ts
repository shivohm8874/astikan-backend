import type { FastifyPluginAsync } from "fastify";

import {
  catalogQuerySchema,
  cancelOrderSchema,
  pincodeQuerySchema,
  pincodeSchema,
  referenceSchema,
  rescheduleOrderSchema,
  searchTestBodySchema,
  searchTestSchema,
  sendNotificationSchema,
  testDescriptionBodySchema,
  testDescriptionSchema,
} from "./lab.schema";
import {
  buildLabService,
  type CancelOrderBody,
  type RescheduleOrderBody,
} from "./lab.service";

const LAB_CACHE_PRELOAD_KEYWORDS = [
  "",
  "cbc",
  "complete blood count",
  "blood test",
  "hba1c",
  "blood sugar",
  "glucose",
  "fasting sugar",
  "post prandial",
  "lipid profile",
  "cholesterol",
  "hdl",
  "ldl",
  "triglycerides",
  "liver function",
  "lft",
  "sgpt",
  "sgot",
  "bilirubin",
  "kidney function",
  "kft",
  "creatinine",
  "urea",
  "uric acid",
  "thyroid",
  "thyroid profile",
  "tsh",
  "t3",
  "t4",
  "vitamin d",
  "vitamin b12",
  "b12",
  "iron profile",
  "ferritin",
  "esr",
  "crp",
  "dengue",
  "malaria",
  "widal",
  "typhoid",
  "fever profile",
  "urine routine",
  "urine culture",
  "electrolytes",
  "calcium",
  "hormone",
  "insulin",
  "testosterone",
  "allergy",
  "ige",
];

const labRoutes: FastifyPluginAsync = async (app) => {
  const labService = buildLabService(app.config);
  void labService
    .warmCatalogCache(LAB_CACHE_PRELOAD_KEYWORDS)
    .then(() => app.log.info("Lab cache warmup completed"))
    .catch((error) => app.log.warn({ error }, "Lab cache warmup failed"));

  app.get(
    "/catalog",
    { schema: catalogQuerySchema },
    async (request) => {
      const query = request.query as {
        keyword?: string;
        limit?: number;
        offset?: number;
      };
      const keyword = typeof query.keyword === "string" ? query.keyword : "";
      const limit = typeof query.limit === "number" ? query.limit : 1500;
      const offset = typeof query.offset === "number" ? query.offset : 0;
      const data = await labService.catalog(keyword, limit, offset);
      return { status: "ok", data };
    }
  );

  app.get(
    "/search-test",
    { schema: searchTestSchema },
    async (request) => {
      const { keyword = "" } = request.query as { keyword?: string };
      const data = await labService.searchTest(keyword);
      return { status: "ok", data };
    }
  );

  app.post(
    "/search-test",
    { schema: searchTestBodySchema },
    async (request) => {
      const { keyword = "" } = request.body as { keyword?: string };
      const data = await labService.searchTest(keyword);
      return { status: "ok", data };
    }
  );

  app.get(
    "/test-description/:testid",
    { schema: testDescriptionSchema },
    async (request) => {
      const { testid } = request.params as { testid: string };
      const data = await labService.testDescription(testid);
      return { status: "ok", data };
    }
  );

  app.post(
    "/test-description",
    { schema: testDescriptionBodySchema },
    async (request) => {
      const { testid } = request.body as { testid: string };
      const data = await labService.testDescription(testid);
      return { status: "ok", data };
    }
  );

  app.get(
    "/get-pincode/:pincode",
    { schema: pincodeSchema },
    async (request) => {
      const { pincode } = request.params as { pincode: string };
      const data = await labService.getPincode(pincode);
      return { status: "ok", data };
    }
  );

  app.get("/get-pincode", { schema: pincodeQuerySchema }, async (request) => {
    const { pincode } = request.query as { pincode: string };
    const data = await labService.getPincode(pincode);
    return { status: "ok", data };
  });

  app.post("/book-order", async (request) => {
    const payload = request.body as Record<string, unknown>;
    const data = await labService.bookOrder(payload);
    return { status: "ok", data };
  });

  app.get(
    "/order-status/:reference",
    { schema: referenceSchema },
    async (request) => {
      const { reference } = request.params as { reference: string };
      const data = await labService.orderStatus(reference);
      return { status: "ok", data };
    }
  );

  app.post(
    "/cancel-order",
    { schema: cancelOrderSchema },
    async (request) => {
      const payload = request.body as CancelOrderBody;
      const data = await labService.cancelOrder(payload);
      return { status: "ok", data };
    }
  );

  app.post(
    "/reschedule-order",
    { schema: rescheduleOrderSchema },
    async (request) => {
      const payload = request.body as RescheduleOrderBody;
      const data = await labService.rescheduleOrder(payload);
      return { status: "ok", data };
    }
  );

  app.get(
    "/payment-status/:reference",
    { schema: referenceSchema },
    async (request) => {
      const { reference } = request.params as { reference: string };
      const data = await labService.paymentStatus(reference);
      return { status: "ok", data };
    }
  );

  app.post("/payment-link", async (request) => {
    const payload = request.body as Record<string, unknown>;
    const data = await labService.paymentLink(payload);
    return { status: "ok", data };
  });

  app.post(
    "/send-notification",
    { schema: sendNotificationSchema },
    async (request, reply) => {
      const payload = request.body as {
        authorization: string;
        order_id: string | number;
        reference_id: string | number;
        request_status: string;
      };

      if (payload.authorization.trim() !== app.config.NIRAMAYA_AUTH) {
        return reply.code(401).send({
          status: "error",
          message: "Invalid notification authorization",
        });
      }

      app.log.info(
        {
          order_id: payload.order_id,
          reference_id: payload.reference_id,
          request_status: payload.request_status,
        },
        "Niramaya notification received"
      );

      return { status: "ok", message: "Notification accepted" };
    }
  );
};

export default labRoutes;
