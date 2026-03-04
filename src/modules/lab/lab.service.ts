import axios from "axios";
import https from "node:https";

import type { AppEnv } from "../../config/env";
import { cacheGet, cacheSet } from "./lab.cache";

type NiramayaConfig = Pick<
  AppEnv,
  | "NIRAMAYA_TEST_URL"
  | "NIRAMAYA_PROD_URL"
  | "NIRAMAYA_PINCODE_URL"
  | "NIRAMAYA_AUTH"
  | "NIRAMAYA_ALLOW_INSECURE_TLS"
  | "REDIS_URL"
  | "REDIS_TTL_SECONDS"
>;
type HttpMethod = "GET" | "POST";
type Payload = Record<string, unknown>;
type NiramayaHost = "test" | "prod" | "pincode";
type NiramayaSearchItem = {
  Search?: {
    id?: string | number;
    test_code?: string;
    test_parameter?: string;
    reporting_time?: string | null;
    test_mrp?: string | number | null;
  };
};

export type LabCatalogTest = {
  id: string;
  code: string;
  name: string;
  reportingTime: string;
  price: number | null;
  category: string;
};

export type LabCatalogResponse = {
  keyword: string;
  total: number;
  categories: Array<{ name: string; count: number }>;
  tests: LabCatalogTest[];
};

export type CancelOrderBody = {
  reference: string;
  closedReason: string;
};

export type RescheduleOrderBody = {
  reference: string;
  new_date: number;
  old_date: number;
};

export const buildLabService = (config: NiramayaConfig) => {
  const catalogBaseKey = (keyword: string) =>
    `lab:catalog-base:${keyword.trim().toLowerCase() || "__all__"}`;

  const inferCategory = (name: string): string => {
    const n = name.toLowerCase();

    if (/thyroid|hormone|insulin|amh|testosterone|estrogen/.test(n)) {
      return "Hormone Test";
    }
    if (/vitamin|b12|folate/.test(n)) {
      return "Vitamin Test";
    }
    if (/liver|sgot|sgpt|bilirubin|alp/.test(n)) {
      return "Liver Test";
    }
    if (/kidney|creatinine|urea|urine/.test(n)) {
      return "Kidney Test";
    }
    if (/lipid|cholesterol|triglyceride|hdl|ldl/.test(n)) {
      return "Lipid Test";
    }
    if (/sugar|glucose|hba1c|diabet/.test(n)) {
      return "Diabetes Test";
    }
    if (/cbc|blood|hemoglobin|esr|wbc|platelet/.test(n)) {
      return "Blood Test";
    }
    if (/allergy|ige|igg|igm|ana|antibody/.test(n)) {
      return "Immunity Test";
    }

    return "General Test";
  };

  const toCatalogTest = (item: NiramayaSearchItem): LabCatalogTest | null => {
    const row = item.Search;
    const id = row?.id ? String(row.id) : "";
    const name = row?.test_parameter?.trim() ?? "";

    if (!id || !name) {
      return null;
    }

    const code = row?.test_code?.trim() ?? "";
    const reportingTime = row?.reporting_time?.trim() || "Not available";
    const priceRaw =
      typeof row?.test_mrp === "number"
        ? row.test_mrp
        : Number.parseFloat(String(row?.test_mrp ?? "").replace(/[^\d.]/g, ""));
    const price = Number.isFinite(priceRaw) ? priceRaw : null;

    return {
      id,
      code,
      name,
      reportingTime,
      price,
      category: inferCategory(name),
    };
  };

  const normalizeBaseUrl = (url: string): string =>
    url.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");

  const buildUrl = (host: NiramayaHost, endpoint: string): string => {
    const hostBase =
      host === "test"
        ? config.NIRAMAYA_TEST_URL
        : host === "prod"
          ? config.NIRAMAYA_PROD_URL
          : config.NIRAMAYA_PINCODE_URL;
    const base = hostBase.replace(/\/+$/, "");
    let path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

    if (base.endsWith("/api") && path.startsWith("/api/")) {
      path = path.slice(4);
    }

    return `${base}${path}`;
  };

  const callNiramaya = async <T = unknown>(
    host: NiramayaHost,
    endpoint: string,
    method: HttpMethod,
    options?: {
      data?: Payload;
      params?: Payload;
    }
  ): Promise<T> => {
    try {
      const response = await axios({
        url: buildUrl(host, endpoint),
        method,
        httpsAgent: config.NIRAMAYA_ALLOW_INSECURE_TLS
          ? new https.Agent({ rejectUnauthorized: false })
          : undefined,
        headers: {
          "Content-Type": "application/json",
          Authorization: config.NIRAMAYA_AUTH,
        },
        data: options?.data,
        params: options?.params,
      });

      if (
        typeof response.data === "string" &&
        /<!doctype html>|<html/i.test(response.data)
      ) {
        throw new Error("Upstream returned HTML instead of JSON");
      }

      return response.data as T;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const upstreamMessage = error.response?.data
          ? JSON.stringify(error.response.data)
          : error.message;
        throw new Error(`Niramaya API error at ${endpoint}: ${upstreamMessage}`);
      }

      if (error instanceof Error) {
        throw new Error(`Niramaya API error at ${endpoint}: ${error.message}`);
      }

      throw new Error(`Niramaya API error at ${endpoint}: Unknown error`);
    }
  };

  const callPincodeWithFallback = async (pincode: string) => {
    const params = {
      pincode,
      authorization: config.NIRAMAYA_AUTH,
    };

    try {
      return await callNiramaya("pincode", "/api/getpincode", "GET", {
        params,
      });
    } catch (firstError: unknown) {
      const message =
        firstError instanceof Error ? firstError.message : String(firstError);
      const shouldFallback = /404|not found|upstream returned html/i.test(
        message
      );
      const differentHost =
        normalizeBaseUrl(config.NIRAMAYA_PINCODE_URL) !==
        normalizeBaseUrl(config.NIRAMAYA_PROD_URL);

      if (!shouldFallback || !differentHost) {
        throw firstError;
      }

      return callNiramaya("prod", "/api/getpincode", "GET", { params });
    }
  };

  const getCatalogBase = async (keyword = "") => {
    const cacheKey = catalogBaseKey(keyword);
    const cachedBase = await cacheGet<{
      keyword: string;
      total: number;
      categories: Array<{ name: string; count: number }>;
      tests: LabCatalogTest[];
    }>(cacheKey, config.REDIS_URL);

    if (cachedBase) {
      return cachedBase;
    }

    const raw = await callNiramaya<NiramayaSearchItem[]>(
      "prod",
      "/api/searchtest",
      "POST",
      {
        data: { keyword },
      }
    );

    const unique = new Map<string, LabCatalogTest>();
    for (const item of raw ?? []) {
      const parsed = toCatalogTest(item);
      if (!parsed) {
        continue;
      }
      if (!unique.has(parsed.id)) {
        unique.set(parsed.id, parsed);
      }
    }

    const sortedTests = Array.from(unique.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    const categoryCounts = new Map<string, number>();
    for (const test of sortedTests) {
      categoryCounts.set(test.category, (categoryCounts.get(test.category) ?? 0) + 1);
    }

    const categories = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));

    const base = {
      keyword,
      total: sortedTests.length,
      categories,
      tests: sortedTests,
    };

    await cacheSet(cacheKey, base, config.REDIS_TTL_SECONDS, config.REDIS_URL);
    return base;
  };

  return {
    searchTest: (keyword: string) =>
      callNiramaya("prod", "/api/searchtest", "POST", {
        data: { keyword },
      }),

    catalog: async (
      keyword = "",
      limit = 200,
      offset = 0
    ): Promise<LabCatalogResponse> => {
      const base = await getCatalogBase(keyword);

      const start = Math.max(0, offset);
      const tests = base.tests.slice(start, start + limit);

      return {
        keyword: base.keyword,
        total: base.total,
        categories: base.categories,
        tests,
      };
    },

    warmCatalogCache: async (keywords: string[]) => {
      await Promise.all(
        keywords.map(async (keyword) => {
          try {
            await getCatalogBase(keyword);
          } catch {
            // Keep warmup best-effort.
          }
        })
      );
    },

    testDescription: (testid: string) =>
      callNiramaya("prod", "/api/test_description", "POST", {
        data: { testid },
      }),

    getPincode: (pincode: string) => callPincodeWithFallback(pincode),

    bookOrder: (payload: Payload) => {
      const normalizedPayload: Payload = {
        ...payload,
        authorization: config.NIRAMAYA_AUTH,
        payment_type: "1",
        amount_collected: "0",
        amount_to_be_collected: "0",
        city: payload.city ?? "",
        state: payload.state ?? "",
      };

      if (payload.zip_code && !payload.Pin_code) {
        normalizedPayload.Pin_code = payload.zip_code;
      }

      return callNiramaya("test", "/api/addorder", "POST", {
        data: normalizedPayload,
      });
    },

    orderStatus: (reference: string) =>
      callNiramaya("test", "/api/orderstatus", "POST", {
        data: {
          reference_id: reference,
          authorization: config.NIRAMAYA_AUTH,
        },
      }),

    cancelOrder: (body: CancelOrderBody) =>
      callNiramaya("prod", "/api/cancel_order", "POST", {
        data: {
          status: "Request Cancelled",
          authorization: config.NIRAMAYA_AUTH,
          reference: body.reference,
          closedReason: body.closedReason,
        },
      }),

    rescheduleOrder: (body: RescheduleOrderBody) =>
      callNiramaya("prod", "/api/reschedule_order", "POST", {
        data: {
          status: "Request Rescheduled",
          authorization: config.NIRAMAYA_AUTH,
          reference: body.reference,
          new_date: body.new_date,
          old_date: body.old_date,
        },
      }),

    paymentStatus: (reference: string) =>
      callNiramaya("prod", "/api/payment_detail", "POST", {
        data: {
          authorization: config.NIRAMAYA_AUTH,
          reference,
        },
      }),

    paymentLink: (payload: Payload) =>
      callNiramaya("prod", "/api/payment_link", "POST", {
        data: {
          authorization: config.NIRAMAYA_AUTH,
          ...payload,
        },
      }),
  };
};
