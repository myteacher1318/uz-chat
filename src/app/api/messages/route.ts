import { getSupabase } from "@/lib/supabaseServer";

// 한 번에 내려주는 메시지 수 제한 — 대화가 아무리 길어도 첫 로드와
// 렌더링이 무거워지지 않게 한다. 이전 페이지는 before 커서로 이어 받는다.
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;

// GET /api/messages?conversationId=...[&limit=80][&before=<created_at>]
//  : 최근 limit개를 created_at 오름차순으로 { messages, hasMore } 형태로.
//    before(커서)를 주면 그 시각 이전(더 오래된) 페이지를 돌려준다.
export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const conversationId = params.get("conversationId");
  if (!conversationId) {
    return Response.json(
      { error: "conversationId가 필요합니다." },
      { status: 400 },
    );
  }

  const limitRaw = Number(params.get("limit"));
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;
  const before = params.get("before");

  try {
    const supabase = getSupabase();
    let query = supabase
      .from("messages")
      .select("role, content, attachments, model, created_at")
      .eq("conversation_id", conversationId);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit + 1); // +1: 더 오래된 메시지가 남았는지 판별용
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
    return Response.json({ messages: page, hasMore });
  } catch (err) {
    console.error("[messages:GET]", err);
    return Response.json(
      { error: "메시지를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
