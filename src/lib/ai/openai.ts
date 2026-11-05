import OpenAI from "openai";
import { isImageMediaType, isTextMediaType } from "@/lib/attachments";
import { stripMarkerChars } from "@/lib/streamMarkers";
import type { NeutralMessage, StreamOptions } from "./types";

// 한 응답에서 web_search 를 부를 수 있는 최대 횟수 — Claude 쪽(claude.ts 의
// WEB_SEARCH_MAX_USES)과 같은 값. 없으면 모델이 검색을 수십 번 돌려 비용이 튈 수 있다.
const WEB_SEARCH_MAX_CALLS = 6;

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
    } else if (isTextMediaType(a.mediaType)) {
      // 텍스트는 별도 첨부 형식 없이 본문에 끼워 넣는다. 파일명을 함께 적어
      // 모델이 어느 파일 내용인지 구분할 수 있게 한다.
      parts.push({
        type: "input_text",
        text: `[첨부 파일: ${a.name}]\n${Buffer.from(a.data, "base64").toString("utf8")}`,
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
    ...(webSearch
      ? { tools: [{ type: "web_search" as const }], max_tool_calls: WEB_SEARCH_MAX_CALLS }
      : {}),
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let sawText = false;
  // 정상 종료가 아닌 끝맺음 — 스트림이 조용히 끝나지 않도록 안내로 바꾼다.
  let incomplete: "max_output_tokens" | "content_filter" | "unknown" | null = null;

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      if (event.delta) sawText = true;
      yield stripMarkerChars(event.delta);
    } else if (event.type === "response.completed") {
      const u = event.response.usage;
      inputTokens = u?.input_tokens ?? inputTokens;
      outputTokens = u?.output_tokens ?? outputTokens;
    } else if (event.type === "response.incomplete") {
      const u = event.response.usage;
      inputTokens = u?.input_tokens ?? inputTokens;
      outputTokens = u?.output_tokens ?? outputTokens;
      incomplete = event.response.incomplete_details?.reason ?? "unknown";
    } else if (event.type === "response.failed") {
      // 서버가 응답 생성에 실패했다 — 라우트가 오류 안내로 바꾼다.
      const e = event.response.error;
      const err = new Error(e?.message ?? "response.failed") as Error & { code?: string };
      err.code = e?.code ?? "response_failed";
      throw err;
    } else if (event.type === "error") {
      const err = new Error(event.message) as Error & { code?: string | null };
      err.code = event.code;
      throw err;
    }
  }

  if (incomplete === "max_output_tokens") {
    yield sawText
      ? "\n\n⚠️ 출력 한도에 도달해 답변이 여기서 잘렸습니다. 이어서 써 달라고 요청하거나 질문을 나눠 보세요."
      : "⚠️ 출력 한도 안에서 답변을 만들지 못했습니다. 질문을 줄여 다시 시도해 주세요.";
  } else if (incomplete === "content_filter") {
    yield "\n\n⚠️ 콘텐츠 정책에 따라 응답이 중단되었습니다. 질문을 다르게 표현해 보세요.";
  } else if (incomplete) {
    yield "\n\n⚠️ 응답이 완료되지 못했습니다. 다시 시도해 주세요.";
  } else if (!sawText) {
    yield "⚠️ 모델이 빈 응답을 보냈습니다. 다시 시도해 주세요.";
  }

  onUsage?.({ input: inputTokens, output: outputTokens });
}
