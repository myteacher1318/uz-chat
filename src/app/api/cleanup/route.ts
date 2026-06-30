import { getSupabase } from "@/lib/supabaseServer";
import { deleteAnthropicFile, listAnthropicFiles } from "@/lib/ai/claude";

// 정기 정리: DB가 더 이상 참조하지 않는 Anthropic 업로드 파일(orphan)을 삭제한다.
// - Vercel Cron이 GET으로 호출 (vercel.json 참고).
// - 업로드 직후 메시지 저장 전 race를 피하려고, 24시간 이내 파일은 건드리지 않는다.

export const maxDuration = 60;

const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24h

// 인증: CRON_SECRET 이 설정돼 있으면 Bearer 토큰 요구.
// 미설정 시 프로덕션에서는 거부(열린 정리 엔드포인트 방지), 개발에서는 허용.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function runCleanup(): Promise<Response> {
  const supabase = getSupabase();

  // 1) DB가 참조하는 모든 file_id 수집
  const { data: rows, error } = await supabase
    .from("messages")
    .select("attachments")
    .not("attachments", "is", null);
  if (error) throw error;

  const referenced = new Set<string>();
  for (const r of rows ?? []) {
    if (!Array.isArray(r.attachments)) continue;
    for (const a of r.attachments) {
      if (
        a &&
        typeof a === "object" &&
        typeof (a as { fileId?: unknown }).fileId === "string"
      ) {
        referenced.add((a as { fileId: string }).fileId);
      }
    }
  }

  // 2) Anthropic 파일 중 DB에 없고 충분히 오래된 것 삭제
  const files = await listAnthropicFiles();
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  let deleted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const f of files) {
    if (referenced.has(f.id)) {
      skipped += 1;
      continue;
    }
    if (new Date(f.createdAt).getTime() > cutoff) {
      // 너무 최근 → 업로드 진행 중일 수 있으니 다음 정리 때까지 보류
      skipped += 1;
      continue;
    }
    try {
      await deleteAnthropicFile(f.id);
      deleted += 1;
    } catch (e) {
      console.error("[cleanup] delete failed", f.id, e);
      errors.push(f.id);
    }
  }

  return Response.json({
    totalFiles: files.length,
    referenced: referenced.size,
    deleted,
    skipped,
    errors: errors.length,
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await runCleanup();
  } catch (err) {
    console.error("[cleanup]", err);
    return Response.json({ error: "정리 작업에 실패했습니다." }, { status: 500 });
  }
}

// 수동 트리거 편의를 위해 POST도 동일 처리
export const POST = GET;
