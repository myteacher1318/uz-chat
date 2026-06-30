import Anthropic from "@anthropic-ai/sdk";
import { streamClaude } from "@/lib/ai/claude";
import { getSupabase } from "@/lib/supabaseServer";
import {
  INLINE_MAX_BYTES,
  PDF_TYPE,
  isAllowedType,
  isImageMediaType,
} from "@/lib/attachments";

// ─────────────────────────────────────────────────────────────
// 허용 모델 — 클라이언트가 임의 모델을 주입하지 못하도록 화이트리스트.
//   'claude-sonnet-4-6'          — 속도/품질 균형 (기본)
//   'claude-opus-4-8'            — 최고 품질 (느리고 비쌈)
//   'claude-haiku-4-5-20251001'  — 저렴하고 빠름
// ─────────────────────────────────────────────────────────────
const ALLOWED_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
] as const;
const DEFAULT_MODEL = "claude-sonnet-4-6";

const MAX_TOKENS = 4096;

// 비용 보호
const DEFAULT_HISTORY_LIMIT = 20; // settings 조회 실패 시 fallback (최근 N개 전송)
const MAX_INPUT_CHARS = 8000; // 마지막 메시지 텍스트 최대 길이

const SYSTEM_PROMPT = `당신은 친절하고 똑똑한 한국어 AI 어시스턴트입니다.
- 항상 한국어로, 자연스럽고 명확하게 답변합니다.
- 사용자의 의도를 정확히 파악하고, 핵심을 먼저 말한 뒤 필요한 설명을 덧붙입니다.
- 모르는 것은 솔직하게 모른다고 말하고, 추측할 때는 추측임을 밝힙니다.
- 코드나 예시가 도움이 되면 적절히 제공합니다.
- 이미지나 PDF가 첨부되면 그 내용을 함께 참고해 답변합니다.`;

// Vercel 서버리스 함수 시간 초과 대비 (초 단위)
export const maxDuration = 60;

// Supabase 미설정이어도 채팅은 동작하도록 (저장만 건너뜀)
function getSupabaseSafe() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

// settings.message_history_limit 를 읽어 "최근 N개" 한계로 사용. 실패 시 기본값.
async function getHistoryLimit(
  supabase: ReturnType<typeof getSupabaseSafe>,
): Promise<number> {
  if (!supabase) return DEFAULT_HISTORY_LIMIT;
  try {
    const { data } = await supabase
      .from("settings")
      .select("message_history_limit")
      .eq("id", 1)
      .single();
    const n = data?.message_history_limit;
    return typeof n === "number" && Number.isInteger(n) && n > 0
      ? n
      : DEFAULT_HISTORY_LIMIT;
  } catch {
    return DEFAULT_HISTORY_LIMIT;
  }
}

// base64 문자열의 대략적인 디코딩 바이트 수
function approxBytesFromBase64(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// 첨부에서 DB 저장용 메타데이터만 추출 (base64 데이터는 저장하지 않음).
// Files API 첨부는 file_id도 함께 저장한다 — 대화 삭제 시 Anthropic 파일 정리용.
function attachmentMeta(
  attachments: unknown,
): { name: string; type: string; fileId?: string }[] | null {
  if (!Array.isArray(attachments)) return null;
  const meta = attachments
    .filter(
      (
        a,
      ): a is { name: string; mediaType: string; kind?: string; fileId?: string } =>
        !!a &&
        typeof a === "object" &&
        typeof (a as { name?: unknown }).name === "string" &&
        typeof (a as { mediaType?: unknown }).mediaType === "string",
    )
    .map((a) => {
      const o: { name: string; type: string; fileId?: string } = {
        name: a.name,
        type: a.mediaType,
      };
      if (a.kind === "file" && typeof a.fileId === "string") o.fileId = a.fileId;
      return o;
    });
  return meta.length ? meta : null;
}

export async function POST(req: Request): Promise<Response> {
  // 1) 본문 파싱
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }

  const root = body as
    | { messages?: unknown; model?: unknown; conversationId?: unknown }
    | null;
  const messages = root?.messages;
  if (!Array.isArray(messages)) {
    return Response.json(
      { error: "messages는 배열이어야 합니다." },
      { status: 400 },
    );
  }

  const conversationId =
    typeof root?.conversationId === "string" && root.conversationId
      ? root.conversationId
      : null;

  // 2) 모델 검증: 허용 목록에 없으면 기본값으로 fallback (임의 모델 주입 방지)
  const requested = root?.model;
  const model =
    typeof requested === "string" &&
    (ALLOWED_MODELS as readonly string[]).includes(requested)
      ? requested
      : DEFAULT_MODEL;

  // 3) 마지막 메시지 텍스트 길이 제한
  const lastRaw = messages[messages.length - 1] as
    | { role?: unknown; content?: unknown; attachments?: unknown }
    | undefined;
  const lastText = typeof lastRaw?.content === "string" ? lastRaw.content : "";
  if (lastText.length > MAX_INPUT_CHARS) {
    return Response.json(
      { error: `메시지가 너무 깁니다. (최대 ${MAX_INPUT_CHARS.toLocaleString()}자)` },
      { status: 400 },
    );
  }

  // 4) 메시지 → Anthropic content 블록으로 변환
  //    첨부: kind:"inline"(base64, 작은 파일) / kind:"file"(Files API file_id, 큰 파일)
  const built: Anthropic.Beta.BetaMessageParam[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { role?: unknown; content?: unknown; attachments?: unknown };
    if (m.role !== "user" && m.role !== "assistant") continue;

    const text = typeof m.content === "string" ? m.content : "";

    if (m.role === "assistant") {
      if (text.length === 0) continue;
      built.push({ role: "assistant", content: text });
      continue;
    }

    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    const attachments = Array.isArray(m.attachments) ? m.attachments : [];

    for (const a of attachments) {
      if (!a || typeof a !== "object") continue;
      const att = a as {
        kind?: unknown;
        mediaType?: unknown;
        data?: unknown;
        fileId?: unknown;
      };
      if (typeof att.mediaType !== "string") continue;
      // 복원된 메시지의 메타데이터 전용 첨부(데이터 없음)는 건너뜀
      if (att.kind !== "file" && att.kind !== "inline") continue;
      if (!isAllowedType(att.mediaType)) {
        return Response.json(
          { error: `지원하지 않는 첨부 형식입니다: ${att.mediaType}` },
          { status: 400 },
        );
      }
      const mt = att.mediaType;

      if (att.kind === "file" && typeof att.fileId === "string") {
        if (isImageMediaType(mt)) {
          blocks.push({ type: "image", source: { type: "file", file_id: att.fileId } });
        } else {
          blocks.push({ type: "document", source: { type: "file", file_id: att.fileId } });
        }
      } else if (att.kind === "inline" && typeof att.data === "string") {
        if (approxBytesFromBase64(att.data) > INLINE_MAX_BYTES) {
          return Response.json(
            { error: "인라인 첨부가 너무 큽니다." },
            { status: 400 },
          );
        }
        if (isImageMediaType(mt)) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: mt, data: att.data },
          });
        } else {
          blocks.push({
            type: "document",
            source: { type: "base64", media_type: PDF_TYPE, data: att.data },
          });
        }
      } else {
        continue;
      }
    }

    if (text.length > 0) blocks.push({ type: "text", text });
    if (blocks.length === 0) continue;

    built.push({ role: "user", content: blocks });
  }

  if (built.length === 0) {
    return Response.json(
      { error: "유효한 메시지가 없습니다." },
      { status: 400 },
    );
  }

  // 5) 비용 보호: 최근 N개만 전송 (N은 settings에서 읽고, 실패 시 기본 20)
  const supabase = getSupabaseSafe();
  const historyLimit = await getHistoryLimit(supabase);
  const recent = built.slice(-historyLimit);

  // 6) (부수 처리) 새 user 메시지를 DB에 저장 — base64는 저장하지 않고 메타만.
  const nowIso = () => new Date().toISOString();
  if (supabase && conversationId && lastRaw?.role === "user") {
    try {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: lastText,
        attachments: attachmentMeta(lastRaw.attachments),
      });
      await supabase
        .from("conversations")
        .update({ updated_at: nowIso() })
        .eq("id", conversationId);
    } catch (err) {
      console.error("[api/chat] user message save error:", err);
    }
  }

  // 7) Claude 스트림을 클라이언트로 흘려보내며, 동시에 전체 텍스트를 누적해
  //    스트림 종료 시 assistant 메시지를 저장한다.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of streamClaude({
          model,
          system: SYSTEM_PROMPT,
          messages: recent,
          maxTokens: MAX_TOKENS,
        })) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }

        if (supabase && conversationId && full.trim()) {
          try {
            await supabase.from("messages").insert({
              conversation_id: conversationId,
              role: "assistant",
              content: full,
              model,
              attachments: null,
            });
            await supabase
              .from("conversations")
              .update({ updated_at: nowIso() })
              .eq("id", conversationId);
          } catch (err) {
            console.error("[api/chat] assistant message save error:", err);
          }
        }
      } catch (err) {
        console.error("[api/chat] streaming error:", err);
        const detail = err instanceof Error ? err.message : "알 수 없는 오류";
        controller.enqueue(
          encoder.encode(`\n\n⚠️ 응답 생성 중 문제가 발생했습니다: ${detail}`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
