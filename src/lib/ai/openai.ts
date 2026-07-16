import OpenAI from "openai";
import { isImageMediaType } from "@/lib/attachments";
import type { NeutralMessage } from "./types";

export interface StreamOptions {
  model: string;
  system: string;
  messages: NeutralMessage[];
  maxTokens: number;
  // Anthropic 전용 옵션 — OpenAI 경로에서는 무시된다 (인터페이스 호환용)
  thinking?: boolean;
  effort?: "low" | "medium" | "high";
  cache?: boolean;
  // 웹 검색 도구 사용 여부 — Responses API의 web_search 서버 도구.
  webSearch?: boolean;
  // 응답 종료 시 토큰 사용량을 알려준다 (사용량 집계용). best-effort.
  onUsage?: (u: { input: number; output: number }) => void;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY 환경변수가 설정되지 않았습니다. .env.local 에 키를 추가하세요.",
    );
  }
  client = new OpenAI({ apiKey });
  return client;
}

// 중립 메시지 → Responses API 입력 메시지.
// (GPT-5.6부터 웹 검색 등 서버 도구는 Responses API에서만 지원되어 이전함)
function toResponseMessage(m: NeutralMessage): OpenAI.Responses.ResponseInputItem {
  if (m.role === "assistant") return { role: "assistant", content: m.text };

  const parts: OpenAI.Responses.ResponseInputMessageContentList = [];
  for (const a of m.attachments) {
    // OpenAI는 Anthropic Files API의 file_id를 쓸 수 없으므로 인라인(base64)만 지원.
    if (a.kind !== "inline" || !a.data) continue;
    if (isImageMediaType(a.mediaType)) {
      parts.push({
        type: "input_image",
        detail: "auto",
        image_url: `data:${a.mediaType};base64,${a.data}`,
      });
    } else if (a.mediaType === "application/pdf") {
      parts.push({
        type: "input_file",
        filename: a.name,
        file_data: `data:application/pdf;base64,${a.data}`,
      });
    }
  }
  if (m.text) parts.push({ type: "input_text", text: m.text });
  if (parts.length === 0) return { role: "user", content: m.text };
  return { role: "user", content: parts };
}

/** OpenAI(GPT)를 호출해 응답 텍스트를 델타 단위로 흘려보낸다. */
export async function* streamOpenAI({
  model,
  system,
  messages,
  maxTokens,
  webSearch,
  onUsage,
}: StreamOptions): AsyncGenerator<string> {
  const openai = getClient();

  const stream = await openai.responses.create({
    model,
    instructions: system,
    input: messages.map(toResponseMessage),
    max_output_tokens: maxTokens,
    stream: true,
    // 대화 저장은 Supabase가 담당 — OpenAI 서버에는 응답을 남기지 않는다.
    store: false,
    // 웹 검색 서버 도구 — 선언만 하면 모델이 필요할 때 알아서 검색한다.
    ...(webSearch ? { tools: [{ type: "web_search" as const }] } : {}),
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      yield event.delta;
    } else if (event.type === "response.completed") {
      const u = event.response.usage;
      inputTokens = u?.input_tokens ?? inputTokens;
      outputTokens = u?.output_tokens ?? outputTokens;
    }
  }

  onUsage?.({ input: inputTokens, output: outputTokens });
}
