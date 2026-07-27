import { getSupabase } from "@/lib/supabaseServer";
import { deleteAnthropicFile } from "@/lib/ai/claude";
import { bumpCounters, clientIp, recordAccess } from "@/lib/usage";

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
    // 누적 대화 수 카운터 +1 (대화를 삭제해도 이 값은 줄지 않는다).
    void bumpCounters(supabase, { conversations: 1 });
    return Response.json(data);
  } catch (err) {
    console.error("[conversations:POST]", err);
    return Response.json({ error: "대화를 생성하지 못했습니다." }, { status: 500 });
  }
}

const LIST_LIMIT = 100; // 사이드바 표시용 — 무한정 커지지 않게 최근 N개만
const SEARCH_MSG_SCAN = 300; // 본문 검색 시 훑어볼 메시지 행 수 상한

// ilike 패턴에서 와일드카드(%, _)와 이스케이프 문자를 문자 그대로 취급하게 한다.
// (이게 없으면 "100%" 같은 입력이 전체 매칭으로 번진다)
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// GET /api/conversations[?q=검색어]  : 목록을 updated_at 내림차순으로.
// q가 있으면 제목과 메시지 본문을 함께 찾아 합친다.
// 페이지 최초 로드 시 호출되므로 여기서 접속 IP도 누적 기록한다.
export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const q = raw.slice(0, 100); // 과도하게 긴 검색어 차단

  try {
    const supabase = getSupabase();
    void recordAccess(supabase, clientIp(req), req.headers.get("user-agent"));

    if (!q) {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return Response.json(data ?? []);
    }

    const pattern = `%${escapeLike(q)}%`;

    // 제목 매칭과 본문 매칭을 동시에 조회한다. 본문 매칭은 대화 id만 모은 뒤
    // 2차 조회로 제목·시각을 채운다 (messages 에는 title/updated_at 이 없다).
    const [titleHits, msgHits] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, title, updated_at")
        .ilike("title", pattern)
        .order("updated_at", { ascending: false })
        .limit(LIST_LIMIT),
      supabase
        .from("messages")
        .select("conversation_id")
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(SEARCH_MSG_SCAN),
    ]);
    if (titleHits.error) throw titleHits.error;

    const byId = new Map<string, { id: string; title: string; updated_at: string }>();
    for (const c of titleHits.data ?? []) byId.set(c.id, c);

    const extraIds = [
      ...new Set(
        (msgHits.data ?? [])
          .map((m) => m.conversation_id as string)
          .filter((id) => id && !byId.has(id)),
      ),
    ];
    if (extraIds.length > 0) {
      const { data: extra } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .in("id", extraIds);
      for (const c of extra ?? []) byId.set(c.id, c);
    }

    const merged = [...byId.values()]
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, LIST_LIMIT);
    return Response.json(merged);
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
