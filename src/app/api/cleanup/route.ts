import { del as delBlob, list as listBlobs } from "@vercel/blob";
import { getSupabase } from "@/lib/supabaseServer";
import { deleteAnthropicFile, listAnthropicFiles } from "@/lib/ai/claude";
import { secretMatches } from "@/lib/signedToken";

// 정기 정리 — 외부 크론(cron-job.org)이 하루 1회 호출한다 (설정법: README).
//  1) DB가 더 이상 참조하지 않는 Anthropic 업로드 파일(orphan) 삭제
//  2) 큰 파일 첨부 경로의 임시 Vercel Blob 중 오래 남은 것 삭제
// 업로드 직후 메시지 저장 전 race를 피하려고, 24시간 이내 파일은 건드리지 않는다.

const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24h
// Supabase(PostgREST)는 한 번에 최대 1,000행만 돌려주고 오류를 내지 않는다.
// 페이지 단위로 끝까지 읽지 않으면 1,000행 밖의 첨부가 "참조 없음"으로 오판돼
// 멀쩡한 파일이 지워진다. 페이지 수 상한은 폭주 방지용(100만 행).
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

// 인증: CRON_SECRET 이 설정돼 있으면 Bearer 토큰 요구.
// 미설정 시 프로덕션에서는 거부(열린 정리 엔드포인트 방지), 개발에서는 허용.
async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return secretMatches(token, secret);
}

// DB가 참조하는 모든 file_id — 끝까지 페이지를 넘겨 읽는다. 어느 페이지든 실패하면
// 목록이 불완전하므로 throw 해 이번 정리를 통째로 건너뛴다 (지우는 쪽이 더 위험).
async function collectReferencedFileIds(): Promise<Set<string>> {
  const supabase = getSupabase();
  const referenced = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data: rows, error } = await supabase
      .from("messages")
      .select("attachments")
      .not("attachments", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
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
    if (!rows || rows.length < PAGE_SIZE) break;
  }
  return referenced;
}

async function cleanAnthropicFiles(cutoff: number) {
  const referenced = await collectReferencedFileIds();
  const files = await listAnthropicFiles();
  let deleted = 0;
  let skipped = 0;
  let errors = 0;

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
      console.error("[cleanup] file delete failed", f.id, e);
      errors += 1;
    }
  }
  return { totalFiles: files.length, referenced: referenced.size, deleted, skipped, errors };
}

// 임시 Blob: 브라우저 → Blob → /api/files → Anthropic 전송이 끝나면 바로 지우지만,
// 전송 단계에서 실패하거나 탭이 닫히면 남는다. 이 스토어의 Blob 은 전부 임시 용도라
// 오래된 것은 모두 지워도 된다. 토큰이 없으면(큰 파일 첨부 미사용) 건너뛴다.
async function cleanBlobs(cutoff: number) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { available: false, total: 0, deleted: 0, errors: 0 };
  }
  let total = 0;
  let deleted = 0;
  let errors = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listBlobs({ cursor, limit: PAGE_SIZE });
    total += res.blobs.length;
    const stale = res.blobs
      .filter((b) => new Date(b.uploadedAt).getTime() <= cutoff)
      .map((b) => b.url);
    if (stale.length > 0) {
      try {
        await delBlob(stale);
        deleted += stale.length;
      } catch (e) {
        console.error("[cleanup] blob delete failed", e);
        errors += stale.length;
      }
    }
    if (!res.hasMore || !res.cursor) break;
    cursor = res.cursor;
  }
  return { available: true, total, deleted, errors };
}

export async function GET(req: Request): Promise<Response> {
  if (!(await authorized(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  try {
    const files = await cleanAnthropicFiles(cutoff);
    let blobs: Awaited<ReturnType<typeof cleanBlobs>>;
    try {
      blobs = await cleanBlobs(cutoff);
    } catch (err) {
      console.error("[cleanup] blob cleanup failed", err);
      blobs = { available: true, total: 0, deleted: 0, errors: 1 };
    }
    return Response.json({ ...files, blobs });
  } catch (err) {
    console.error("[cleanup]", err);
    return Response.json({ error: "정리 작업에 실패했습니다." }, { status: 500 });
  }
}

// 수동 트리거 편의를 위해 POST도 동일 처리
export const POST = GET;
