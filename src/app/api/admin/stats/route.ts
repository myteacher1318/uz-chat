import { getSupabase } from "@/lib/supabaseServer";
import { listAnthropicFiles } from "@/lib/ai/claude";

// 보호됨(proxy). 사용량 집계.
// 핵심: 대화를 삭제해도 통계가 남도록, 라이브 테이블(conversations/messages)이 아니라
//       분리된 누적 카운터(usage_counters) / 원장(usage_events) / 접속로그(access_log)를 읽는다.

type CounterMap = Record<string, number>;

// usage_counters(key/value) → 맵. 테이블/행이 없으면 0.
async function readCounters(
  supabase: ReturnType<typeof getSupabase>,
): Promise<CounterMap> {
  const map: CounterMap = {};
  try {
    const { data, error } = await supabase
      .from("usage_counters")
      .select("key, value");
    if (error) throw error;
    for (const r of data ?? []) {
      if (typeof r.key === "string") map[r.key] = Number(r.value) || 0;
    }
  } catch (err) {
    console.error("[admin/stats] readCounters", err);
  }
  return map;
}

export async function GET(): Promise<Response> {
  try {
    const supabase = getSupabase();

    // 1) 누적 카운터 (삭제와 무관하게 보존)
    const counters = await readCounters(supabase);
    const num = (k: string) => counters[k] ?? 0;

    // 2) 토큰/모델 원장 — 모델별 집계 + 최근 7일 추이 (원장도 삭제와 무관)
    const modelMap = new Map<
      string,
      { count: number; inputTokens: number; outputTokens: number }
    >();
    const dayMap = new Map<string, { messages: number; tokens: number }>();
    try {
      const { data, error } = await supabase
        .from("usage_events")
        .select("created_at, model, input_tokens, output_tokens");
      if (error) throw error;
      for (const e of data ?? []) {
        const model =
          typeof e.model === "string" && e.model ? e.model : "(unknown)";
        const inTok = Number(e.input_tokens) || 0;
        const outTok = Number(e.output_tokens) || 0;
        const m = modelMap.get(model) ?? {
          count: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        m.count += 1;
        m.inputTokens += inTok;
        m.outputTokens += outTok;
        modelMap.set(model, m);

        if (typeof e.created_at === "string") {
          const day = e.created_at.slice(0, 10); // UTC YYYY-MM-DD
          const d = dayMap.get(day) ?? { messages: 0, tokens: 0 };
          d.messages += 1;
          d.tokens += inTok + outTok;
          dayMap.set(day, d);
        }
      }
    } catch (err) {
      console.error("[admin/stats] usage_events", err);
    }

    const byModel = Array.from(modelMap.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.count - a.count);

    // 최근 7일 (UTC, 빈 날은 0)
    const now = new Date();
    const last7Days: { date: string; messages: number; tokens: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
      );
      const key = dt.toISOString().slice(0, 10);
      const d = dayMap.get(key) ?? { messages: 0, tokens: 0 };
      last7Days.push({ date: key, messages: d.messages, tokens: d.tokens });
    }

    // 3) 현재(라이브) 저장 상태 — 지금 DB에 남아있는 대화/메시지 수
    const [{ count: liveConversations }, { count: liveMessages }] =
      await Promise.all([
        supabase
          .from("conversations")
          .select("*", { count: "exact", head: true }),
        supabase.from("messages").select("*", { count: "exact", head: true }),
      ]);

    // 4) 접속 IP 누적 기록
    let access: {
      total: number;
      rows: {
        ip: string;
        hits: number;
        firstSeen: string | null;
        lastSeen: string | null;
        userAgent: string | null;
      }[];
    } = { total: 0, rows: [] };
    try {
      const { data, count, error } = await supabase
        .from("access_log")
        .select("ip, hits, first_seen, last_seen, last_user_agent", {
          count: "exact",
        })
        .order("last_seen", { ascending: false })
        .limit(200);
      if (error) throw error;
      access = {
        total: count ?? (data?.length ?? 0),
        rows: (data ?? []).map((r) => ({
          ip: String(r.ip),
          hits: Number(r.hits) || 0,
          firstSeen: (r.first_seen as string) ?? null,
          lastSeen: (r.last_seen as string) ?? null,
          userAgent: (r.last_user_agent as string) ?? null,
        })),
      };
    } catch (err) {
      console.error("[admin/stats] access_log", err);
    }

    // 5) 현재 첨부 저장 용량 — Anthropic Files API 실제 저장분 (best-effort)
    let filesApi: { available: boolean; count: number; bytes: number } = {
      available: false,
      count: 0,
      bytes: 0,
    };
    try {
      const files = await listAnthropicFiles();
      filesApi = {
        available: true,
        count: files.length,
        bytes: files.reduce((s, f) => s + (f.sizeBytes || 0), 0),
      };
    } catch (err) {
      console.error("[admin/stats] listAnthropicFiles", err);
    }

    return Response.json({
      cumulative: {
        conversations: num("conversations"),
        userMessages: num("user_messages"),
        assistantMessages: num("assistant_messages"),
        inputTokens: num("input_tokens"),
        outputTokens: num("output_tokens"),
        totalTokens: num("input_tokens") + num("output_tokens"),
        attachmentCount: num("attachment_count"),
        attachmentBytes: num("attachment_bytes"),
      },
      live: {
        conversations: liveConversations ?? 0,
        messages: liveMessages ?? 0,
        filesApi,
      },
      byModel,
      last7Days,
      access,
    });
  } catch (err) {
    console.error("[admin/stats:GET]", err);
    return Response.json(
      { error: "통계를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
