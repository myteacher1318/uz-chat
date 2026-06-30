import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { PDF_TYPE, isImageMediaType } from "@/lib/attachments";
import type { NeutralMessage } from "./types";

// Files API는 베타라 messages 호출에도 동일 베타 헤더가 필요하다.
const FILES_BETA = "files-api-2025-04-14";

export interface StreamOptions {
  model: string;
  system: string;
  messages: NeutralMessage[];
  maxTokens: number;
}

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

// 중립 메시지 → Anthropic content 블록
function toAnthropicMessage(m: NeutralMessage): Anthropic.Beta.BetaMessageParam {
  if (m.role === "assistant") return { role: "assistant", content: m.text };

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of m.attachments) {
    if (a.kind === "file" && a.fileId) {
      blocks.push(
        isImageMediaType(a.mediaType)
          ? { type: "image", source: { type: "file", file_id: a.fileId } }
          : { type: "document", source: { type: "file", file_id: a.fileId } },
      );
    } else if (a.kind === "inline" && a.data) {
      if (isImageMediaType(a.mediaType)) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: a.mediaType, data: a.data },
        });
      } else {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: PDF_TYPE, data: a.data },
        });
      }
    }
  }
  if (m.text) blocks.push({ type: "text", text: m.text });
  return { role: "user", content: blocks.length ? blocks : m.text };
}

/** Claude를 호출해 응답 텍스트를 델타 단위로 흘려보낸다. */
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
    messages: messages.map(toAnthropicMessage),
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

/** Anthropic Files API에 올라간 파일 1개 삭제 (대화 삭제 시 정리용). */
export async function deleteAnthropicFile(fileId: string): Promise<void> {
  const anthropic = getClient();
  await anthropic.beta.files.delete(fileId, { betas: [FILES_BETA] });
}

/** Anthropic Files API의 전체 파일 목록(id, 생성시각). 정기 정리용. */
export async function listAnthropicFiles(): Promise<
  { id: string; createdAt: string }[]
> {
  const anthropic = getClient();
  const result: { id: string; createdAt: string }[] = [];
  for await (const f of anthropic.beta.files.list({ betas: [FILES_BETA] })) {
    result.push({ id: f.id, createdAt: f.created_at });
  }
  return result;
}
