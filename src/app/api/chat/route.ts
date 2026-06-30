import { streamClaude, type ChatMessage } from "@/lib/ai/claude";

// ─────────────────────────────────────────────────────────────
// 모델 ID — 교체가 쉽도록 상단 상수로 선언.
//   기본값: 'claude-sonnet-4-6'  (속도/품질 균형)
//   대안:
//     'claude-opus-4-8'   — 최고 품질 (느리고 비쌈)
//     'claude-haiku-4-5'  — 저렴하고 빠름
// ─────────────────────────────────────────────────────────────
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

// 비용 보호
const MAX_MESSAGES = 20; // Claude로 보내는 최근 메시지 개수
const MAX_INPUT_CHARS = 8000; // 마지막 메시지 최대 길이

const SYSTEM_PROMPT = `당신은 친절하고 똑똑한 한국어 AI 어시스턴트입니다.
- 항상 한국어로, 자연스럽고 명확하게 답변합니다.
- 사용자의 의도를 정확히 파악하고, 핵심을 먼저 말한 뒤 필요한 설명을 덧붙입니다.
- 모르는 것은 솔직하게 모른다고 말하고, 추측할 때는 추측임을 밝힙니다.
- 코드나 예시가 도움이 되면 적절히 제공합니다.`;

// Vercel 서버리스 함수 시간 초과 대비 (초 단위)
export const maxDuration = 60;

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string"
  );
}

export async function POST(req: Request): Promise<Response> {
  // 1) 본문 파싱
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 JSON 요청입니다." }, { status: 400 });
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) {
    return Response.json(
      { error: "messages는 배열이어야 합니다." },
      { status: 400 },
    );
  }

  // 2) 형식 검증 + 정규화 (role/content 만 남긴다)
  const normalized: ChatMessage[] = messages
    .filter(isChatMessage)
    .map(({ role, content }) => ({ role, content }));

  if (normalized.length === 0) {
    return Response.json(
      { error: "유효한 메시지가 없습니다." },
      { status: 400 },
    );
  }

  // 3) 마지막 메시지 길이 제한
  const last = normalized[normalized.length - 1];
  if (last.content.length > MAX_INPUT_CHARS) {
    return Response.json(
      { error: `메시지가 너무 깁니다. (최대 ${MAX_INPUT_CHARS.toLocaleString()}자)` },
      { status: 400 },
    );
  }

  // 4) 비용 보호: 최근 MAX_MESSAGES개만 전송
  const recent = normalized.slice(-MAX_MESSAGES);

  // 5) Claude 스트림을 ReadableStream으로 브라우저에 흘려보낸다
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of streamClaude({
          model: MODEL,
          system: SYSTEM_PROMPT,
          messages: recent,
          maxTokens: MAX_TOKENS,
        })) {
          controller.enqueue(encoder.encode(text));
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
