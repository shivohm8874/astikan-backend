import type { FastifyPluginAsync } from "fastify";

const weatherRoutes: FastifyPluginAsync = async (app) => {
  app.get("/now", async (request, reply) => {
    const query = request.query as { lat?: string; lon?: string };
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return reply.code(400).send({ status: "error", message: "lat/lon required" });
    }
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url);
    if (!res.ok) {
      return reply.code(502).send({ status: "error", message: "Weather provider unavailable" });
    }
    const data = await res.json() as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
        weather_code?: number;
      };
    };

    const weatherCode = Number(data.current?.weather_code ?? 0);
    const condition = mapWeatherCodeToCondition(weatherCode);
    const tempC = Number(data.current?.temperature_2m ?? 0);
    const humidity = Number(data.current?.relative_humidity_2m ?? 0);
    const windKph = Number(data.current?.wind_speed_10m ?? 0);

    let aqi: number | null = null;
    let pm25: number | null = null;
    let pm10: number | null = null;
    let location = "";

    try {
      const openAqKey = app.config.OPENAQ_API_KEY?.trim();
      if (openAqKey) {
        const locUrl = new URL("https://api.openaq.org/v3/locations");
        locUrl.searchParams.set("coordinates", `${lat},${lon}`);
        locUrl.searchParams.set("radius", "25000");
        locUrl.searchParams.set("limit", "1");
        const locRes = await fetch(locUrl, {
          headers: { "X-API-Key": openAqKey },
        });
        if (locRes.ok) {
          const locData = await locRes.json() as {
            results?: Array<{ id?: number; name?: string }>;
          };
          const loc = locData.results?.[0];
          if (loc?.id) {
            location = loc.name ?? "";
            const latestUrl = new URL(`https://api.openaq.org/v3/locations/${loc.id}/latest`);
            const latestRes = await fetch(latestUrl, {
              headers: { "X-API-Key": openAqKey },
            });
            if (latestRes.ok) {
              const latestData = await latestRes.json() as {
                results?: Array<{ measurements?: Array<{ parameter?: string; value?: number }> }>;
              };
              const first = latestData.results?.[0];
              for (const m of first?.measurements ?? []) {
                if (m.parameter === "pm25") pm25 = typeof m.value === "number" ? m.value : pm25;
                if (m.parameter === "pm10") pm10 = typeof m.value === "number" ? m.value : pm10;
              }
              if (typeof pm25 === "number") aqi = pm25ToAqi(pm25);
            }
          }
        }
      }
    } catch {
      // keep AQI optional
    }

    return {
      status: "ok",
      data: {
        tempC,
        condition,
        humidity,
        windKph: Math.round(windKph),
        location,
        aqi,
        pm25,
        pm10,
      },
    };
  });
};

export default weatherRoutes;

function mapWeatherCodeToCondition(code: number) {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly cloudy";
  if (code === 3) return "cloudy";
  if ((code >= 45 && code <= 48)) return "fog";
  if ((code >= 51 && code <= 57)) return "drizzle";
  if ((code >= 61 && code <= 67)) return "rain";
  if ((code >= 71 && code <= 77)) return "snow";
  if ((code >= 80 && code <= 82)) return "rain";
  if ((code >= 95 && code <= 99)) return "storm";
  return "clear";
}

function pm25ToAqi(pm25: number) {
  const breakpoints = [
    { cLow: 0, cHigh: 12, aLow: 0, aHigh: 50 },
    { cLow: 12.1, cHigh: 35.4, aLow: 51, aHigh: 100 },
    { cLow: 35.5, cHigh: 55.4, aLow: 101, aHigh: 150 },
    { cLow: 55.5, cHigh: 150.4, aLow: 151, aHigh: 200 },
    { cLow: 150.5, cHigh: 250.4, aLow: 201, aHigh: 300 },
    { cLow: 250.5, cHigh: 350.4, aLow: 301, aHigh: 400 },
    { cLow: 350.5, cHigh: 500.4, aLow: 401, aHigh: 500 },
  ];
  const bp = breakpoints.find((b) => pm25 >= b.cLow && pm25 <= b.cHigh);
  if (!bp) return Math.round(Math.max(0, Math.min(500, pm25)));
  const aqi = ((bp.aHigh - bp.aLow) / (bp.cHigh - bp.cLow)) * (pm25 - bp.cLow) + bp.aLow;
  return Math.round(aqi);
}
