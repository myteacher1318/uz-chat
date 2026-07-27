import { generateTitle, streamClaude } from "@/lib/ai/claude";
import { streamOpenAI } from "@/lib/ai/openai";
import { depthParams, resolveModel, resolveThinkingDepth } from "@/lib/ai/models";
import { getSupabase } from "@/lib/supabaseServer";
import { INLINE_MAX_BYTES, isAllowedType } from "@/lib/attachments";
import {
  bumpCounters,
  clientIp,
  recordAccess,
  recordUsageEvent,
} from "@/lib/usage";
import type { NeutralAttachment, NeutralMessage } from "@/lib/ai/types";

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
let historyLimitCache: { value: number; expiresAt: number } | null = null;

async function getHistoryLimitFast(
  supabase: ReturnType<typeof getSupabaseSafe>,
): Promise<number> {
  if (!supabase) return DEFAULT_HISTORY_LIMIT;

  const now = Date.now();
  if (historyLimitCache && historyLimitCache.expiresAt > now) {
    return historyLimitCache.value;
  }

  const fetchAndCache = getHistoryLimit(supabase)
    .then((n) => {
      historyLimitCache = { value: n, expiresAt: Date.now() + 60_000 };
      return n;
    })
    .catch(() => DEFAULT_HISTORY_LIMIT);

  const timeoutMs = 200;
  return await Promise.race<number>([
    fetchAndCache,
    new Promise<number>((resolve) =>
      setTimeout(() => resolve(DEFAULT_HISTORY_LIMIT), timeoutMs),
    ),
  ]);
}

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
    | {
        messages?: unknown;
        model?: unknown;
        conversationId?: unknown;
        webSearch?: unknown;
        depth?: unknown;
        mode?: unknown;
      }
    | null;
  const messages = root?.messages;
  const webSearchRequested = root?.webSearch === true;
  // 사고 깊이 — 허용값 밖이면 기본값(빠르게)으로 보정.
  const depth = resolveThinkingDepth(
    typeof root?.depth === "string" ? root.depth : undefined,
  );
  // normal: 새 질문 / regenerate: 같은 질문으로 응답만 다시 / edit: 마지막 턴 교체
  const mode: "normal" | "regenerate" | "edit" =
    root?.mode === "regenerate" || root?.mode === "edit" ? root.mode : "normal";
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

  // 2) 모델 검증 + provider 결정 (허용 목록에 없으면 기본값으로 fallback)
  const modelDef = resolveModel(
    typeof root?.model === "string" ? root.model : undefined,
  );
  const model = modelDef.id;

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

  // 4) 메시지 → 중립 표현으로 파싱/검증
  const built: NeutralMessage[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { role?: unknown; content?: unknown; attachments?: unknown };
    if (m.role !== "user" && m.role !== "assistant") continue;

    const text = typeof m.content === "string" ? m.content : "";

    if (m.role === "assistant") {
      if (text.length === 0) continue;
      built.push({ role: "assistant", text, attachments: [] });
      continue;
    }

    const attachments: NeutralAttachment[] = [];
    const rawAtts = Array.isArray(m.attachments) ? m.attachments : [];
    for (const a of rawAtts) {
      if (!a || typeof a !== "object") continue;
      const att = a as {
        kind?: unknown;
        mediaType?: unknown;
        data?: unknown;
        fileId?: unknown;
        name?: unknown;
      };
      if (typeof att.mediaType !== "string") continue;
      if (att.kind !== "file" && att.kind !== "inline") continue;
      if (!isAllowedType(att.mediaType)) {
        return Response.json(
          { error: `지원하지 않는 첨부 형식입니다: ${att.mediaType}` },
          { status: 400 },
        );
      }
      const name = typeof att.name === "string" ? att.name : "file";

      if (att.kind === "file" && typeof att.fileId === "string") {
        attachments.push({
          kind: "file",
          name,
          mediaType: att.mediaType,
          fileId: att.fileId,
        });
      } else if (att.kind === "inline" && typeof att.data === "string") {
        if (approxBytesFromBase64(att.data) > INLINE_MAX_BYTES) {
          return Response.json(
            { error: "인라인 첨부가 너무 큽니다." },
            { status: 400 },
          );
        }
        attachments.push({
          kind: "inline",
          name,
          mediaType: att.mediaType,
          data: att.data,
        });
      }
    }

    if (text.length === 0 && attachments.length === 0) continue;
    built.push({ role: "user", text, attachments });
  }

  if (built.length === 0) {
    return Response.json(
      { error: "유효한 메시지가 없습니다." },
      { status: 400 },
    );
  }

  // 5) 비용 보호: 최근 N개만 전송 (N은 settings에서 읽고, 실패 시 기본 20)
  const supabase = getSupabaseSafe();
  const historyLimit = await getHistoryLimitFast(supabase);
  const recent = built.slice(-historyLimit);
  // Anthropic API는 첫 메시지가 user여야 한다 — 잘린 히스토리가
  // assistant로 시작하면(짝수 limit에서 발생) 앞쪽 assistant를 제거.
  while (recent.length > 0 && recent[0].role === "assistant") recent.shift();
  if (recent.length === 0) {
    return Response.json(
      { error: "유효한 메시지가 없습니다." },
      { status: 400 },
    );
  }

  // 5.2) 재생성/수정 모드: 대화 끝의 이전 턴 기록을 정리해 DB 중복을 막는다.
  //  - regenerate: 마지막 assistant 응답(들)만 삭제 (새 응답으로 대체)
  //  - edit: 마지막 assistant 응답(들) + 마지막 user 메시지 삭제 (수정본으로 대체)
  // 이 재정리(이전 턴 삭제)는 반드시 아래 6)의 새 user 저장보다 먼저 끝나야 한다.
  // 병렬(fire-and-forget)로 두면 edit 모드에서 재정리의 SELECT가 방금 넣은 새 user
  // 메시지를 함께 읽어 지워버리는 경쟁이 생긴다. edit/regenerate는 드물고 일반 대화
  // 경로에선 실행되지 않으므로, 여기서 await 해도 체감 응답 지연(TTFT)엔 영향이 없다.
  if (supabase && conversationId && mode !== "normal") {
    try {
      const { data: tail } = await supabase
        .from("messages")
        .select("id, role")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(10);
      const ids: string[] = [];
      for (const r of tail ?? []) {
        if (r.role === "assistant") {
          ids.push(r.id);
          continue;
        }
        if (r.role === "user" && mode === "edit") ids.push(r.id);
        break;
      }
      if (ids.length > 0) {
        await supabase.from("messages").delete().in("id", ids);
      }
    } catch (err) {
      console.error("[api/chat] turn reconcile error:", err);
    }
  }

  // 5.5) 사용량/접속 집계 — conversations/messages 와 분리된 누적 카운터에 기록.
  //      (대화 저장 여부·삭제와 무관하게 남는다. 인라인 첨부 용량도 여기서 누적)
  //      재생성은 새 질문이 아니므로 user_messages 를 다시 세지 않는다.
  if (supabase && lastRaw?.role === "user" && mode !== "regenerate") {
    const rawAtts = Array.isArray(lastRaw.attachments) ? lastRaw.attachments : [];
    let inlineCount = 0;
    let inlineBytes = 0;
    for (const a of rawAtts) {
      if (
        a &&
        typeof a === "object" &&
        (a as { kind?: unknown }).kind === "inline" &&
        typeof (a as { data?: unknown }).data === "string"
      ) {
        inlineCount += 1;
        inlineBytes += approxBytesFromBase64((a as { data: string }).data);
      }
    }
    void bumpCounters(supabase, {
      user_messages: 1,
      attachment_count: inlineCount,
      attachment_bytes: inlineBytes,
    });
    void recordAccess(supabase, clientIp(req), req.headers.get("user-agent"));
  }

  // 6) (부수 처리) 새 user 메시지를 DB에 저장 — base64는 저장하지 않고 메타만.
  //    재생성 모드에서는 같은 질문이 이미 저장돼 있으므로 건너뛴다.
  const nowIso = () => new Date().toISOString();
  if (supabase && conversationId && lastRaw?.role === "user" && mode !== "regenerate") {
    void (async () => {
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
    })();
  }

  // 7) provider 선택 후 스트림. 동시에 전체 텍스트를 누적해 종료 시 assistant 저장.
  const streamFn = modelDef.provider === "openai" ? streamOpenAI : streamClaude;
  // 웹 검색은 양쪽 다 지원 — Claude는 web_search 서버 도구,
  // GPT는 Responses API의 web_search 도구를 쓴다.
  const webSearch = webSearchRequested;
  // 사고 깊이: adaptive thinking 지원 모델(Sonnet 5·Opus 4.8 등)에서만
  // thinking/effort를 보낸다. Haiku·GPT는 미지원이라 undefined로 두어
  // 파라미터 자체를 생략한다(보내면 400).
  const depthCfg = modelDef.adaptiveThinking === true ? depthParams(depth) : null;
  // 도구가 실제로 있을 때만 지침을 추가 (없는 도구를 언급하면 환각 유발).
  // GPT는 openai.ts가 자체 web_search를 붙이고, Claude는 모델 세대별로 갈린다
  // (구세대는 검색만, 최신 세대는 web_fetch까지).
  const hasSearch =
    webSearch && (modelDef.provider === "openai" || !!modelDef.webTools);
  const hasFetch = webSearch && modelDef.webTools === "latest";
  const system = hasSearch
    ? [
        SYSTEM_PROMPT,
        "- 최신 정보가 필요하거나 사실 확인이 필요하면 web_search 도구로 검색한 뒤 답합니다.",
        ...(hasFetch
          ? [
              "- 대화에 URL이 있고 그 내용이 필요하면 web_fetch 도구로 해당 페이지를 직접 읽고 답합니다.",
            ]
          : []),
      ].join("\n")
    : SYSTEM_PROMPT;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let clientGone = false; // 중지 버튼/탭 닫힘 등으로 클라이언트가 끊긴 상태
      const usageRef: { value: { input: number; output: number } | null } = {
        value: null,
      };
      try {
        for await (const chunk of streamFn({
          model,
          system,
          messages: recent,
          maxTokens: modelDef.maxTokens,
          thinking: depthCfg?.thinking,
          effort: depthCfg?.effort,
          webSearch,
          // 웹 도구 세대 — 모델이 지원하는 변형만 보낸다 (구세대에 최신 변형은 400).
          webTools: modelDef.webTools,
          // Opus 5 등 안전장치가 강한 모델의 거절을 서버가 다른 모델로 이어받게 한다.
          fallbackModel: modelDef.fallbackModel,
          // 히스토리가 잘리기 전(append-only)에만 캐싱 — 윈도우가 밀리기
          // 시작하면 프리픽스가 매번 달라져 캐시 이득이 없다.
          cache: built.length < historyLimit,
          onUsage: (u) => {
            usageRef.value = u;
          },
        })) {
          full += chunk;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // 클라이언트 중단 — 생성을 멈추고 지금까지의 부분 응답만 저장한다.
            clientGone = true;
            break;
          }
        }
      } catch (err) {
        console.error("[api/chat] streaming error:", err);
        const detail = err instanceof Error ? err.message : "알 수 없는 오류";
        if (!clientGone) {
          try {
            controller.enqueue(
              encoder.encode(`\n\n⚠️ 응답 생성 중 문제가 발생했습니다: ${detail}`),
            );
          } catch {
            /* 전송 실패해도 저장은 계속 */
          }
        }
      }

      // 저장/집계는 클라이언트 연결 여부와 무관하게 수행 (부분 응답도 보존)
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

          // 첫 문답이면 Haiku로 대화 제목 생성 — fire-and-forget.
          // (Render 상시 프로세스에서 응답 종료 후에도 완료된다)
          const isFirstUserTurn =
            built.filter((m) => m.role === "user").length === 1;
          if (isFirstUserTurn) {
            const sb = supabase;
            const cid = conversationId;
            void (async () => {
              try {
                const title = await generateTitle(lastText, full);
                if (title) {
                  await sb
                    .from("conversations")
                    .update({ title })
                    .eq("id", cid);
                }
              } catch (err) {
                console.error("[api/chat] title generation error:", err);
              }
            })();
          }
        } catch (err) {
          console.error("[api/chat] assistant message save error:", err);
        }
      }

      // 응답 1건 + 토큰 사용량을 누적 원장에 기록 (삭제와 무관하게 보존).
      // 중단된 응답은 usage 이벤트가 오지 않아 기록되지 않는다 (허용).
      if (supabase && usageRef.value) {
        await recordUsageEvent(supabase, {
          provider: modelDef.provider,
          model,
          input: usageRef.value.input,
          output: usageRef.value.output,
        });
      }

      try {
        controller.close();
      } catch {
        /* 이미 닫힘 */
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
