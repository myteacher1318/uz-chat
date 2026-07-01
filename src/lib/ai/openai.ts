import OpenAI from "openai";
import { isImageMediaType } from "@/lib/attachments";
import type { NeutralMessage } from "./types";

export interface StreamOptions {
  model: string;
  system: string;
  messages: NeutralMessage[];
  maxTokens: number;
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

// 중립 메시지 → OpenAI Chat Completions 메시지
function toOpenAIMessage(
  m: NeutralMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === "assistant") return { role: "assistant", content: m.text };

  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const a of m.attachments) {
    // OpenAI는 Anthropic Files API의 file_id를 쓸 수 없으므로 인라인(base64)만 지원.
    if (a.kind !== "inline" || !a.data) continue;
    if (isImageMediaType(a.mediaType)) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${a.mediaType};base64,${a.data}` },
      });
    } else if (a.mediaType === "application/pdf") {
      parts.push({
        type: "file",
        file: {
          filename: a.name,
          file_data: `data:application/pdf;base64,${a.data}`,
        },
      });
    }
  }
  if (m.text) parts.push({ type: "text", text: m.text });
  if (parts.length === 0) return { role: "user", content: m.text };
  return { role: "user", content: parts };
}

/** OpenAI(GPT)를 호출해 응답 텍스트를 델타 단위로 흘려보낸다. */
export async function* streamOpenAI({
  model,
  system,
  messages,
  maxTokens,
  onUsage,
}: StreamOptions): AsyncGenerator<string> {
  const openai = getClient();

  const oaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...messages.map(toOpenAIMessage),
  ];

  const stream = await openai.chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    messages: oaiMessages,
    stream: true,
    // 마지막 청크에 usage 를 포함시켜 토큰 사용량을 받는다.
    stream_options: { include_usage: true },
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
    // usage 는 보통 choices 가 빈 마지막 청크에 실려 온다.
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
    }
  }

  onUsage?.({ input: inputTokens, output: outputTokens });
}
