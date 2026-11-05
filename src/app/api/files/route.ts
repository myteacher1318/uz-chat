import { del } from "@vercel/blob";
import { uploadToAnthropicFiles } from "@/lib/ai/claude";
import { formatBytes, isAllowedType, maxBytesFor } from "@/lib/attachments";
import { getSupabase } from "@/lib/supabaseServer";
import { bumpCounters } from "@/lib/usage";

// Vercel Blob에 올라간 임시 파일을 받아 Anthropic Files API로 업로드하고
// file_id를 돌려준다. 전송이 끝나면(실패해도) 임시 Blob은 삭제한다.

// 우리 Blob 스토어의 호스트. 토큰은 "vercel_blob_rw_<STORE_ID>_<secret>" 형식이고
// 공개 URL 은 "https://<store_id 소문자>.public.blob.vercel-storage.com/..." 이다.
// 접미사만 보고 허용하면 다른 사람의 스토어 URL(=임의의 큰 파일)을 넘겨 서버가
// 그 파일을 통째로 받게 만들 수 있으므로, 우리 스토어 호스트와 정확히 일치해야 한다.
function ownBlobHost(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const m = token.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  return m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

// 본문을 상한까지만 읽는다 — content-length 가 없거나 거짓이어도 상한을 넘기면 중단해
// 큰 파일이 메모리를 다 차지하지 못하게 한다. 넘치면 null.
async function readBounded(res: Response, limit: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

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

  // SSRF 방지: 우리 Blob 스토어 호스트만, https 만 허용
  const allowedHost = ownBlobHost();
  if (!allowedHost) {
    return Response.json(
      { error: "큰 파일 첨부가 설정되지 않았습니다 (BLOB_READ_WRITE_TOKEN)." },
      { status: 503 },
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "잘못된 URL입니다." }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== allowedHost) {
    return Response.json({ error: "허용되지 않은 URL입니다." }, { status: 400 });
  }

  // 텍스트는 상한이 더 낮다 — 내용이 그대로 토큰이 되기 때문 (attachments.ts 참고)
  const limit = maxBytesFor(mediaType);

  // Blob에서 파일 바이트 가져오기 (리다이렉트는 다른 호스트로 샐 수 있으니 거부)
  let res: Response;
  try {
    res = await fetch(url, { redirect: "error" });
  } catch {
    await del(url).catch(() => {});
    return Response.json({ error: "파일을 가져오지 못했습니다." }, { status: 502 });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    await del(url).catch(() => {});
    return Response.json({ error: "파일을 가져오지 못했습니다." }, { status: 502 });
  }
  const buf = await readBounded(res, limit);
  if (!buf) {
    await del(url).catch(() => {});
    return Response.json(
      { error: `파일이 너무 큽니다. (최대 ${formatBytes(limit)})` },
      { status: 400 },
    );
  }

  try {
    const fileId = await uploadToAnthropicFiles(buf, name.slice(0, 200), mediaType);
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
    console.error("[api/files] upload error:", err);
    return Response.json(
      { error: "파일을 모델 저장소에 올리지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
