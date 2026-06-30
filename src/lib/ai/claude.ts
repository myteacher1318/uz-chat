import Anthropic, { toFile } from "@anthropic-ai/sdk";

// Files API는 베타라 messages 호출에도 동일 베타 헤더가 필요하다.
const FILES_BETA = "files-api-2025-04-14";

export interface StreamOptions {
  model: string;
  system: string;
  /** Anthropic 형식의 메시지. content는 문자열 또는 블록 배열(텍스트+이미지+문서). */
  messages: Anthropic.Beta.BetaMessageParam[];
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
 * file_id 참조(Files API)를 쓰므로 beta messages 엔드포인트를 사용한다.
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

  const stream = anthropic.beta.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages,
    betas: [FILES_BETA],
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

/**
 * 파일 바이트를 Anthropic Files API에 업로드하고 file_id를 돌려준다.
 * 큰 파일(이미지/PDF)을 한 번만 업로드해 두고, 이후 대화에서는 file_id로만 참조한다.
 */
export async function uploadToAnthropicFiles(
  data: Buffer,
  name: string,
  mediaType: string,
): Promise<string> {
  const anthropic = getClient();
  const file = await toFile(data, name, { type: mediaType });
  const uploaded = await anthropic.beta.files.upload({
    file,
    betas: [FILES_BETA],
  });
  return uploaded.id;
}
