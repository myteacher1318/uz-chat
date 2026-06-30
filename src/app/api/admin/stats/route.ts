import { getSupabase } from "@/lib/supabaseServer";

// 보호됨(미들웨어). Supabase 데이터 기반 사용량 집계.
export async function GET(): Promise<Response> {
  try {
    const supabase = getSupabase();

    const { count: conversations } = await supabase
      .from("conversations")
      .select("*", { count: "exact", head: true });

    const { data: msgs, error } = await supabase
      .from("messages")
      .select("role, model, created_at, attachments");
    if (error) throw error;
    const rows = msgs ?? [];

    let user = 0;
    let assistant = 0;
    let withAttachments = 0;
    const modelCounts = new Map<string, number>();
    const dayCounts = new Map<string, number>();

    for (const m of rows) {
      if (m.role === "user") {
        user += 1;
      } else if (m.role === "assistant") {
        assistant += 1;
        const model =
          typeof m.model === "string" && m.model ? m.model : "(unknown)";
        modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
      }
      if (m.attachments != null) withAttachments += 1;
      if (typeof m.created_at === "string") {
        const day = m.created_at.slice(0, 10); // UTC YYYY-MM-DD
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      }
    }

    // 최근 7일 (UTC 기준, 빈 날은 0으로 채움)
    const now = new Date();
    const last7Days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
      );
      const key = d.toISOString().slice(0, 10);
      last7Days.push({ date: key, count: dayCounts.get(key) ?? 0 });
    }

    const byModel = Array.from(modelCounts.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count);

    return Response.json({
      conversations: conversations ?? 0,
      messages: { total: rows.length, user, assistant, withAttachments },
      byModel,
      last7Days,
    });
  } catch (err) {
    console.error("[admin/stats:GET]", err);
    return Response.json(
      { error: "통계를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
