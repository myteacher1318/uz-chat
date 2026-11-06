import { getSupabase } from "@/lib/supabaseServer";

// 보호됨(proxy). 일별·IP 별 사용량 — usage_events 원장을 기간으로 잘라 집계한다.
//   GET /api/admin/usage?days=7|30|90&ip=<선택>
// 날짜 경계는 한국 시간(KST, UTC+9). 원장은 대화 삭제와 무관하게 남으므로 대화를
// 지워도 수치가 줄지 않는다. ip 열은 2026-11-06 에 추가돼 그 전 행은 null 이다.

const PAGE_SIZE = 1000; // PostgREST 는 한 번에 최대 1,000행
const MAX_PAGES = 200;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = [7, 30, 90];
const DEFAULT_DAYS = 30;

type EventRow = {
  createdAt: string;
  inputTokens: number;
  outputTokens: number;
  ip: string | null;
};

type Bucket = { messages: number; inputTokens: number; outputTokens: number };
const emptyBucket = (): Bucket => ({
  messages: 0,
  inputTokens: 0,
  outputTokens: 0,
});
function add(b: Bucket, r: EventRow) {
  b.messages += 1;
  b.inputTokens += r.inputTokens;
  b.outputTokens += r.outputTokens;
}

// KST 날짜 키(YYYY-MM-DD). epoch 에 9시간을 더한 뒤 UTC 날짜를 읽으면 KST 날짜가 된다.
const kstDay = (epochMs: number) =>
  new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 10);

// 기간 내 원장 행 전부 (1,000행 페이지 한도를 넘겨 읽는다).
// ip 열이 아직 없으면(usage_tracking.sql 재실행 전) 42703 이 나므로 ip 없이 다시 읽고
// 그 사실을 응답에 담아 화면이 안내하게 한다.
async function readEvents(
  supabase: ReturnType<typeof getSupabase>,
  sinceIso: string,
): Promise<{ rows: EventRow[]; ipAvailable: boolean; truncated: boolean }> {
  const attempt = async (withIp: boolean) => {
    const rows: EventRow[] = [];
    let truncated = false;
    const columns = withIp
      ? "created_at, input_tokens, output_tokens, ip"
      : "created_at, input_tokens, output_tokens";
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await supabase
        .from("usage_events")
        .select(columns)
        .gte("created_at", sinceIso)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const list = (data ?? []) as unknown as Record<string, unknown>[];
      for (const r of list) {
        rows.push({
          createdAt: String(r.created_at ?? ""),
          inputTokens: Number(r.input_tokens) || 0,
          outputTokens: Number(r.output_tokens) || 0,
          ip: withIp && typeof r.ip === "string" && r.ip ? r.ip : null,
        });
      }
      if (list.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    return { rows, truncated };
  };
  try {
    return { ...(await attempt(true)), ipAvailable: true };
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code !== "42703") throw err; // undefined_column 만 ip 없이 재시도
    return { ...(await attempt(false)), ipAvailable: false };
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = ALLOWED_DAYS.includes(daysParam) ? daysParam : DEFAULT_DAYS;
  // 메모리 안에서 비교만 하므로 형식 검증은 길이만 (DB 질의에 쓰지 않는다)
  const ipFilter = url.searchParams.get("ip")?.trim().slice(0, 64) || null;

  // KST 로 오늘 00:00 에서 (days-1)일 전 00:00 — 를 UTC 로 되돌려 질의한다.
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const startKstMs = Date.UTC(
    nowKst.getUTCFullYear(),
    nowKst.getUTCMonth(),
    nowKst.getUTCDate() - (days - 1),
  );
  const sinceIso = new Date(startKstMs - KST_OFFSET_MS).toISOString();

  try {
    const supabase = getSupabase();
    const { rows, ipAvailable, truncated } = await readEvents(
      supabase,
      sinceIso,
    );

    // 날짜 칸을 먼저 비워 두어 기록이 없는 날도 0 으로 나온다
    const dayMap = new Map<string, Bucket>();
    for (let i = 0; i < days; i++) {
      dayMap.set(
        new Date(startKstMs + i * DAY_MS).toISOString().slice(0, 10),
        emptyBucket(),
      );
    }
    const totals = emptyBucket();
    // IP 별 표는 선택과 무관하게 항상 전체 기준 (IP 선택 목록이 비지 않도록)
    const ipMap = new Map<string | null, Bucket & { lastAt: string | null }>();

    for (const r of rows) {
      const ipRow = ipMap.get(r.ip) ?? { ...emptyBucket(), lastAt: null };
      add(ipRow, r);
      if (!ipRow.lastAt || r.createdAt > ipRow.lastAt) ipRow.lastAt = r.createdAt;
      ipMap.set(r.ip, ipRow);

      if (ipFilter && r.ip !== ipFilter) continue;
      const t = Date.parse(r.createdAt);
      if (Number.isNaN(t)) continue;
      const day = dayMap.get(kstDay(t));
      if (!day) continue; // 경계 밖(시계 오차)
      add(day, r);
      add(totals, r);
    }

    const daily = Array.from(dayMap.entries()).map(([date, b]) => ({
      date,
      ...b,
    }));
    const byIp = Array.from(ipMap.entries())
      .map(([ip, b]) => ({ ip, ...b }))
      .sort(
        (a, b) =>
          b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
      );

    return Response.json({
      days,
      since: sinceIso,
      ip: ipFilter,
      ipAvailable,
      truncated,
      totals,
      daily,
      byIp,
    });
  } catch (err) {
    console.error("[admin/usage:GET]", err);
    return Response.json(
      { error: "사용량을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
