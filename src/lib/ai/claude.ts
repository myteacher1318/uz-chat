import Anthropic from "@anthropic-ai/sdk";

/** 채팅 메시지 한 건. role/content 만 사용하는 최소 형태. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamOptions {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}

// API 키는 서버에서만 읽는다. 클라이언트 번들에 절대 포함되지 않도록
// NEXT_PUBLIC_ 접두사가 없는 환경변수를 사용한다.
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. .env.local 에 키를 추가하세요.",
    );
  }

  client = new Anthropic({ apiKey });
  return client;
}

/**
 * Claude를 호출해 응답 텍스트를 델타 단위로 흘려보낸다.
 *
 * 나중에 OpenAI 등 다른 provider를 추가할 때는 동일한 시그니처의
 * `streamOpenAI` 같은 함수를 옆에 만들고 호출부에서 분기하면 된다.
 */
export async function* streamClaude({
  model,
  system,
  messages,
  maxTokens,
}: StreamOptions): AsyncGenerator<string> {
  const anthropic = getClient();

  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
