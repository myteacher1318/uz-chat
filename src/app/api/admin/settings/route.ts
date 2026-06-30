import { getSupabase } from "@/lib/supabaseServer";

const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

// GET: 현재 설정값
export async function GET(): Promise<Response> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("settings")
      .select("message_history_limit, updated_at")
      .eq("id", 1)
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (err) {
    console.error("[admin/settings:GET]", err);
    return Response.json(
      { error: "설정을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

// PUT: message_history_limit 수정
export async function PUT(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const raw = (body as { messageHistoryLimit?: unknown } | null)
    ?.messageHistoryLimit;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_LIMIT || n > MAX_LIMIT) {
    return Response.json(
      { error: `${MIN_LIMIT}~${MAX_LIMIT} 사이의 정수여야 합니다.` },
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("settings")
      .update({ message_history_limit: n, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .select("message_history_limit, updated_at")
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (err) {
    console.error("[admin/settings:PUT]", err);
    return Response.json({ error: "저장하지 못했습니다." }, { status: 500 });
  }
}
