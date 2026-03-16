import type { FastifyPluginAsync } from "fastify";
import { requireSupabase } from "../core/data";

type WeekendChallenge = {
  id: string;
  slug: string;
  title: string;
  description: string;
  points: number;
  category: "Physical" | "Mental" | "Health" | "Lifestyle";
  difficulty: "Easy" | "Medium" | "Hard";
  duration: string;
};

function getWeekStartDateISO(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const diff = (day + 6) % 7; // Monday as start
  utc.setUTCDate(utc.getUTCDate() - diff);
  return utc.toISOString().slice(0, 10);
}

const challengesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/weekend", async (request) => {
    const { employeeId } = request.query as { employeeId?: string };
    if (!employeeId) {
      return { status: "error", message: "Missing employeeId" };
    }

    const supabase = requireSupabase(app);
    const weekStart = getWeekStartDateISO();

    const { data: challenges, error: challengeError } = await supabase
      .from("weekend_challenges")
      .select("id, slug, title, description, points, category, difficulty, duration")
      .eq("active", true)
      .order("points", { ascending: false });

    if (challengeError) {
      throw new Error(`Failed to load challenges: ${challengeError.message}`);
    }

    const { data: completions, error: completionError } = await supabase
      .from("weekend_challenge_completions")
      .select("challenge_id")
      .eq("employee_id", employeeId)
      .eq("week_start", weekStart);

    if (completionError) {
      throw new Error(`Failed to load completions: ${completionError.message}`);
    }

    const completedIds = new Set((completions ?? []).map((item) => item.challenge_id));
    const payload = (challenges ?? []).map((challenge) => ({
      ...challenge,
      completed: completedIds.has(challenge.id),
    }));

    return {
      status: "ok",
      data: {
        weekStart,
        challenges: payload,
      },
    };
  });

  app.post("/weekend/complete", async (request) => {
    const body = request.body as { employeeId?: string; challengeId?: string };
    if (!body.employeeId || !body.challengeId) {
      return { status: "error", message: "Missing employeeId or challengeId" };
    }

    const supabase = requireSupabase(app);
    const weekStart = getWeekStartDateISO();

    const { error } = await supabase.from("weekend_challenge_completions").upsert(
      {
        employee_id: body.employeeId,
        challenge_id: body.challengeId,
        week_start: weekStart,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,challenge_id,week_start" }
    );

    if (error) {
      throw new Error(`Failed to mark completion: ${error.message}`);
    }

    return {
      status: "ok",
      data: {
        weekStart,
        challengeId: body.challengeId,
      },
    };
  });
};

export default challengesRoutes;
