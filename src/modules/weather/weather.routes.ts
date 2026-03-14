import type { FastifyPluginAsync } from "fastify";

const weatherRoutes: FastifyPluginAsync = async (app) => {
  app.get("/now", async (request, reply) => {
    const query = request.query as { lat?: string; lon?: string };
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return reply.code(400).send({ status: "error", message: "lat/lon required" });
    }
    if (!app.config.OPENWEATHER_API_KEY) {
      return reply.code(503).send({ status: "error", message: "Weather API not configured" });
    }

    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("units", "metric");
    url.searchParams.set("appid", app.config.OPENWEATHER_API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      return reply.code(502).send({ status: "error", message: "Weather provider unavailable" });
    }
    const data = await res.json() as {
      name?: string;
      weather?: Array<{ main?: string; description?: string }>;
      main?: { temp?: number; humidity?: number };
      wind?: { speed?: number };
    };

    const condition = data.weather?.[0]?.main ?? data.weather?.[0]?.description ?? "clear";
    const tempC = Number(data.main?.temp ?? 0);
    const humidity = Number(data.main?.humidity ?? 0);
    const windKph = Number(data.wind?.speed ?? 0) * 3.6;

    return {
      status: "ok",
      data: {
        tempC,
        condition,
        humidity,
        windKph: Math.round(windKph),
        location: data.name ?? "",
      },
    };
  });
};

export default weatherRoutes;
