import { del } from "@vercel/blob";
import { uploadToAnthropicFiles } from "@/lib/ai/claude";
import { isAllowedType, MAX_FILE_BYTES } from "@/lib/attachments";
import { getSupabase } from "@/lib/supabaseServer";
import { bumpCounters } from "@/lib/usage";

// Vercel Blob에 올라간 임시 파일을 받아 Anthropic Files API로 업로드하고
// file_id를 돌려준다. 전송이 끝나면 임시 Blob은 삭제한다.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }

  const { url, name, mediaType } = (body ?? {}) as {
    url?: unknown;
    name?: unknown;
    mediaType?: unknown;
  };

  if (
    typeof url !== "string" ||
    typeof name !== "string" ||
    typeof mediaType !== "string"
  ) {
    return Response.json(
      { error: "url/name/mediaType가 필요합니다." },
      { status: 400 },
    );
  }

  if (!isAllowedType(mediaType)) {
    return Response.json(
      { error: `지원하지 않는 형식입니다: ${mediaType}` },
      { status: 400 },
    );
  }

  // SSRF 방지: Vercel Blob 호스트만 허용
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return Response.json({ error: "잘못된 URL입니다." }, { status: 400 });
  }
  if (!host.endsWith(".blob.vercel-storage.com")) {
    return Response.json({ error: "허용되지 않은 URL입니다." }, { status: 400 });
  }

  // Blob에서 파일 바이트 가져오기
  const res = await fetch(url);
  if (!res.ok) {
    return Response.json(
      { error: "파일을 가져오지 못했습니다." },
      { status: 502 },
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length > MAX_FILE_BYTES) {
    await del(url).catch(() => {});
    return Response.json(
      { error: "파일이 너무 큽니다. (최대 32MB)" },
      { status: 400 },
    );
  }

  try {
    const fileId = await uploadToAnthropicFiles(buf, name, mediaType);
    await del(url).catch(() => {}); // 임시 Blob 정리
    // 첨부(대용량·Files API 저장분) 누적 용량 집계 — best-effort.
    try {
      void bumpCounters(getSupabase(), {
        attachment_count: 1,
        attachment_bytes: buf.length,
      });
    } catch {
      /* Supabase 미설정 등 — 집계만 건너뜀 */
    }
    return Response.json({ fileId });
  } catch (err) {
    await del(url).catch(() => {});
    const msg = err instanceof Error ? err.message : "업로드 실패";
    console.error("[api/files] upload error:", err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
