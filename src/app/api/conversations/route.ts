import { getSupabase } from "@/lib/supabaseServer";
import { deleteAnthropicFile } from "@/lib/ai/claude";

// 메시지 행들의 attachments(jsonb)에서 Anthropic file_id를 모은다.
function collectFileIds(rows: { attachments?: unknown }[] | null): string[] {
  const ids: string[] = [];
  for (const r of rows ?? []) {
    if (!Array.isArray(r.attachments)) continue;
    for (const a of r.attachments) {
      if (
        a &&
        typeof a === "object" &&
        typeof (a as { fileId?: unknown }).fileId === "string"
      ) {
        ids.push((a as { fileId: string }).fileId);
      }
    }
  }
  return ids;
}

// POST /api/conversations  : 새 대화 생성. body.firstMessage 가 있으면 title로 사용.
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const firstMessage = (body as { firstMessage?: unknown } | null)?.firstMessage;
  let title = "새 대화";
  if (typeof firstMessage === "string") {
    const t = firstMessage.trim();
    if (t) title = t.length > 30 ? `${t.slice(0, 30)}…` : t;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title })
      .select("id, title")
      .single();
    if (error) throw error;
    return Response.json(data);
  } catch (err) {
    console.error("[conversations:POST]", err);
    return Response.json({ error: "대화를 생성하지 못했습니다." }, { status: 500 });
  }
}

// GET /api/conversations  : 전체 목록을 updated_at 내림차순으로.
export async function GET(): Promise<Response> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json(data ?? []);
  } catch (err) {
    console.error("[conversations:GET]", err);
    return Response.json({ error: "목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

// DELETE /api/conversations?id=...  : 대화 삭제 (messages는 cascade로 함께 삭제).
// 추가로, 그 대화가 참조하던 Anthropic 업로드 파일도 정리한다.
export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id가 필요합니다." }, { status: 400 });
  }
  try {
    const supabase = getSupabase();

    // 1) 삭제 전, 이 대화의 메시지에서 file_id 수집
    const { data: msgs } = await supabase
      .from("messages")
      .select("attachments")
      .eq("conversation_id", id);
    const fileIds = collectFileIds(msgs);

    // 2) 대화 삭제 (messages는 cascade)
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) throw error;

    // 3) Anthropic 업로드 파일 정리 (best-effort — 실패해도 정기 정리가 잡아줌)
    let deletedFiles = 0;
    for (const fid of fileIds) {
      try {
        await deleteAnthropicFile(fid);
        deletedFiles += 1;
      } catch (e) {
        console.error("[conversations:DELETE] file delete failed", fid, e);
      }
    }

    return Response.json({ ok: true, deletedFiles });
  } catch (err) {
    console.error("[conversations:DELETE]", err);
    return Response.json({ error: "삭제하지 못했습니다." }, { status: 500 });
  }
}
