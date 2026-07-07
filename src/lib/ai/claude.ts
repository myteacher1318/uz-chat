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
  // 사고(thinking) 사용 여부 — adaptive thinking 지원 모델에서만 지정할 것.
  //   true  → thinking: adaptive (모델이 필요할 때 스스로 사고)
  //   false → thinking: disabled (사고 끔 — 가장 빠름)
  //   undefined → 파라미터 미전송 (Haiku 등 미지원 모델용)
  thinking?: boolean;
  // 사고 깊이 → output_config.effort. thinking과 마찬가지로 지원 모델에서만.
  effort?: "low" | "medium" | "high";
  // 웹 검색 서버 도구 사용 여부 (Anthropic 전용)
  webSearch?: boolean;
  // 프롬프트 캐싱 사용 여부 (Anthropic 전용). 히스토리가 append-only 인
  // 동안만 켤 것 — 슬라이딩 윈도우가 시작되면 프리픽스가 바뀌어 캐시가
  // 매번 빗나가면서 쓰기 비용(1.25x)만 든다.
  cache?: boolean;
  // 응답 종료 시 토큰 사용량을 알려준다 (사용량 집계용). best-effort.
  onUsage?: (u: { input: number; output: number }) => void;
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
  thinking,
  effort,
  webSearch,
  cache,
  onUsage,
}: StreamOptions): AsyncGenerator<string> {
  const anthropic = getClient();

  const anthropicMessages = messages.map(toAnthropicMessage);
  // 프롬프트 캐싱: 마지막 메시지의 마지막 블록에 캐시 브레이크포인트를 찍으면
  // 다음 턴에서 이전 대화 전체(시스템+히스토리)가 프리픽스 캐시로 재사용된다.
  // (최소 캐시 길이 미만이면 API가 조용히 무시 — 무해)
  if (cache && anthropicMessages.length > 0) {
    const last = anthropicMessages[anthropicMessages.length - 1];
    if (typeof last.content === "string") {
      last.content = [
        {
          type: "text",
          text: last.content,
          cache_control: { type: "ephemeral" },
        },
      ];
    } else if (last.content.length > 0) {
      (
        last.content[last.content.length - 1] as {
          cache_control?: { type: "ephemeral" };
        }
      ).cache_control = { type: "ephemeral" };
    }
  }

  const stream = anthropic.beta.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages: anthropicMessages,
    betas: [FILES_BETA],
    // 사고(thinking): 지원 모델에서만 지정(true/false). display 기본값(omitted)
    // 이라 사고 내용은 스트림에 노출되지 않고 답변 품질만 올라간다.
    //   adaptive  → 필요할 때만 스스로 사고 (표준/깊게)
    //   disabled  → 사고 끔, 최소 지연 (빠르게)
    ...(thinking !== undefined
      ? {
          thinking: thinking
            ? { type: "adaptive" as const }
            : { type: "disabled" as const },
        }
      : {}),
    // 사고 깊이 → effort. 사고·응답 토큰 예산을 조절한다 (지원 모델 전용).
    ...(effort ? { output_config: { effort } } : {}),
    // 웹 검색은 서버 도구라 선언만 하면 API가 알아서 실행한다.
    // max_uses로 요청당 검색 횟수를 제한해 비용을 방어.
    ...(webSearch
      ? {
          tools: [
            {
              type: "web_search_20260209" as const,
              name: "web_search" as const,
              max_uses: 3,
            },
          ],
        }
      : {}),
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === "message_start") {
      // message_start.message.usage 에 입력 토큰이 들어온다.
      // 캐시 사용 시 input_tokens 는 비캐시 분량만이라 캐시 읽기/쓰기도 합산.
      const u = event.message.usage;
      inputTokens =
        (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0);
    } else if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    } else if (event.type === "message_delta") {
      // message_delta.usage.output_tokens 는 누적 출력 토큰(최종값).
      outputTokens = event.usage.output_tokens ?? outputTokens;
    }
  }

  onUsage?.({ input: inputTokens, output: outputTokens });
}

// 제목 생성 전용 모델 — 가장 저렴하고 빠른 Haiku.
const TITLE_MODEL = "claude-haiku-4-5-20251001";

/** 첫 문답 내용으로 대화 제목(짧은 한국어)을 생성한다. 실패 시 null. */
export async function generateTitle(
  question: string,
  answer: string,
): Promise<string | null> {
  try {
    const anthropic = getClient();
    const res = await anthropic.messages.create({
      model: TITLE_MODEL,
      max_tokens: 64,
      system:
        "대화 목록에 표시할 제목을 만든다. 사용자 질문의 주제를 담아 한국어 15자 이내로. 따옴표·마침표·이모지 없이 제목 텍스트만 출력한다.",
      messages: [
        {
          role: "user",
          content: `질문: ${question.slice(0, 500)}\n\n답변(일부): ${answer.slice(0, 500)}`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "";
    const title = raw.trim().replace(/^["'「]+|["'」.]+$/g, "").trim();
    if (!title) return null;
    return title.length > 30 ? `${title.slice(0, 30)}…` : title;
  } catch (err) {
    console.error("[claude:generateTitle]", err);
    return null;
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

/**
 * Anthropic Files API의 전체 파일 목록(id, 생성시각, 크기).
 * 정기 정리(cleanup)와 관리자 저장 용량 확인에 쓴다.
 */
export async function listAnthropicFiles(): Promise<
  { id: string; createdAt: string; sizeBytes: number }[]
> {
  const anthropic = getClient();
  const result: { id: string; createdAt: string; sizeBytes: number }[] = [];
  for await (const f of anthropic.beta.files.list({ betas: [FILES_BETA] })) {
    result.push({
      id: f.id,
      createdAt: f.created_at,
      sizeBytes: f.size_bytes ?? 0,
    });
  }
  return result;
}
