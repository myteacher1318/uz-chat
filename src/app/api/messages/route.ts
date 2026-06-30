import { getSupabase } from "@/lib/supabaseServer";

// GET /api/messages?conversationId=...  : 해당 대화의 메시지를 created_at 오름차순으로.
export async function GET(req: Request): Promise<Response> {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) {
    return Response.json(
      { error: "conversationId가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("messages")
      .select("role, content, attachments, model, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return Response.json(data ?? []);
  } catch (err) {
    console.error("[messages:GET]", err);
    return Response.json(
      { error: "메시지를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
