import Anthropic from "@anthropic-ai/sdk";
import { streamClaude } from "@/lib/ai/claude";

// ─────────────────────────────────────────────────────────────
// 허용 모델 — 클라이언트가 임의 모델을 주입하지 못하도록 화이트리스트.
// 목록에 없는 값이 오면 기본값으로 fallback.
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
const MAX_MESSAGES = 20; // Claude로 보내는 최근 메시지 개수 (이미지/PDF 포함)
const MAX_INPUT_CHARS = 8000; // 마지막 메시지 텍스트 최대 길이
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 첨부 파일당 최대 10MB

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
type ImageMediaType = (typeof ALLOWED_IMAGE_TYPES)[number];
const PDF_TYPE = "application/pdf";

const SYSTEM_PROMPT = `당신은 친절하고 똑똑한 한국어 AI 어시스턴트입니다.
- 항상 한국어로, 자연스럽고 명확하게 답변합니다.
- 사용자의 의도를 정확히 파악하고, 핵심을 먼저 말한 뒤 필요한 설명을 덧붙입니다.
- 모르는 것은 솔직하게 모른다고 말하고, 추측할 때는 추측임을 밝힙니다.
- 코드나 예시가 도움이 되면 적절히 제공합니다.
- 이미지나 PDF가 첨부되면 그 내용을 함께 참고해 답변합니다.`;

// Vercel 서버리스 함수 시간 초과 대비 (초 단위)
export const maxDuration = 60;

function isImageMediaType(t: string): t is ImageMediaType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(t);
}

// base64 문자열의 대략적인 디코딩 바이트 수
function approxBytesFromBase64(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export async function POST(req: Request): Promise<Response> {
  // 1) 본문 파싱
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }

  const root = body as { messages?: unknown; model?: unknown } | null;
  const messages = root?.messages;
  if (!Array.isArray(messages)) {
    return Response.json(
      { error: "messages는 배열이어야 합니다." },
      { status: 400 },
    );
  }

  // 2) 모델 검증: 허용 목록에 없으면 기본값으로 fallback (임의 모델 주입 방지)
  const requested = root?.model;
  const model =
    typeof requested === "string" &&
    (ALLOWED_MODELS as readonly string[]).includes(requested)
      ? requested
      : DEFAULT_MODEL;

  // 3) 마지막 메시지 텍스트 길이 제한
  const lastRaw = messages[messages.length - 1] as { content?: unknown } | undefined;
  const lastText = typeof lastRaw?.content === "string" ? lastRaw.content : "";
  if (lastText.length > MAX_INPUT_CHARS) {
    return Response.json(
      { error: `메시지가 너무 깁니다. (최대 ${MAX_INPUT_CHARS.toLocaleString()}자)` },
      { status: 400 },
    );
  }

  // 4) 메시지 → Anthropic content 블록으로 변환
  const built: Anthropic.MessageParam[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { role?: unknown; content?: unknown; attachments?: unknown };
    if (m.role !== "user" && m.role !== "assistant") continue;

    const text = typeof m.content === "string" ? m.content : "";

    // 어시스턴트 메시지는 항상 텍스트만
    if (m.role === "assistant") {
      if (text.length === 0) continue;
      built.push({ role: "assistant", content: text });
      continue;
    }

    // 사용자 메시지: 파일 블록 + 텍스트 블록
    const blocks: Anthropic.ContentBlockParam[] = [];
    const attachments = Array.isArray(m.attachments) ? m.attachments : [];

    for (const a of attachments) {
      if (!a || typeof a !== "object") continue;
      const att = a as { mediaType?: unknown; data?: unknown };
      if (typeof att.mediaType !== "string" || typeof att.data !== "string") {
        continue;
      }

      if (approxBytesFromBase64(att.data) > MAX_FILE_BYTES) {
        return Response.json(
          { error: "첨부 파일이 너무 큽니다. (파일당 최대 10MB)" },
          { status: 400 },
        );
      }

      if (isImageMediaType(att.mediaType)) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: att.mediaType, data: att.data },
        });
      } else if (att.mediaType === PDF_TYPE) {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: PDF_TYPE, data: att.data },
        });
      } else {
        return Response.json(
          { error: `지원하지 않는 첨부 형식입니다: ${att.mediaType}` },
          { status: 400 },
        );
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

  // 5) 비용 보호: 최근 MAX_MESSAGES개만 전송
  const recent = built.slice(-MAX_MESSAGES);

  // 6) Claude 스트림을 ReadableStream으로 브라우저에 흘려보낸다
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamClaude({
          model,
          system: SYSTEM_PROMPT,
          messages: recent,
          maxTokens: MAX_TOKENS,
        })) {
          controller.enqueue(encoder.encode(chunk));
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
