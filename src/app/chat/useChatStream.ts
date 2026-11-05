"use client";

import { startTransition, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { ThinkingDepth } from "@/lib/ai/models";
import type { TurnMode } from "@/lib/ai/types";
import { ERROR_MARK, THINK_CLOSE, THINK_OPEN } from "@/lib/streamMarkers";
import { readApiError, type Message } from "./types";

// 토큰 반영 주기 — 매 프레임(초당 60회) 대신 이 간격으로 묶어 반영한다.
// 답변이 길어질수록 말풍선 레이아웃 비용이 커지는데, 반영 횟수를 줄이면
// 그 비용이 1/6로 떨어져 스트리밍 중에도 화면이 매끄럽게 유지된다.
const FLUSH_INTERVAL_MS = 100;

export type StreamSettings = {
  model: string;
  webSearch: boolean;
  depth: ThinkingDepth;
};

/**
 * /api/chat 호출과 스트림 반영. 전송·재생성·수정이 모두 streamTurn 하나를 쓴다.
 * history 는 반드시 user 메시지로 끝나야 한다.
 */
export function useChatStream(
  setMessages: Dispatch<SetStateAction<Message[]>>,
  stickRef: RefObject<boolean>,
  onTurnEnd: () => void,
) {
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function stopGenerating() {
    abortRef.current?.abort();
  }

  async function streamTurn(
    convId: string | null,
    history: Message[],
    mode: TurnMode,
    settings: StreamSettings,
  ) {
    setLoading(true);
    stickRef.current = true; // 전송 시엔 항상 바닥으로
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
        createdAt: new Date().toISOString(),
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    let rafId: number | null = null;
    let flushTimer: number | null = null;
    let lastFlushAt = 0;
    // 서버는 평문 스트림에 마커를 섞어 보낸다(streamMarkers.ts). 아래 읽기 루프가
    // 상태를 보며 본문·사고 요약·오류 안내 세 버퍼로 갈라 담는다.
    let buffered = "";
    let bufferedThink = "";
    let bufferedError = "";
    let inThinking = false;
    let inError = false; // ERROR_MARK 이후는 전부 오류 안내 (마커가 더 오지 않는다)

    const applyBuffered = (finalize: boolean) => {
      const delta = buffered;
      const deltaThink = bufferedThink;
      const deltaError = bufferedError;
      buffered = "";
      bufferedThink = "";
      bufferedError = "";
      setMessages((prev) => {
        const idx = prev.findLastIndex((m) => m.id === assistantId);
        if (idx < 0) return prev;
        const cur = prev[idx];
        const content = cur.content + delta;
        const errorNote = deltaError ? (cur.errorNote ?? "") + deltaError : cur.errorNote;
        const copy = [...prev];
        // 본문이 하나도 없이 오류로 끝났으면 오류 말풍선으로 바꾼다.
        if (finalize && !content && errorNote) {
          copy[idx] = { ...cur, content: `⚠️ ${errorNote}`, error: true, streaming: false };
          return copy;
        }
        copy[idx] = {
          ...cur,
          content,
          thinking: deltaThink ? (cur.thinking ?? "") + deltaThink : cur.thinking,
          errorNote,
          streaming: finalize ? false : cur.streaming,
        };
        return copy;
      });
    };

    const cancelScheduledFlush = () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const scheduleFlush = () => {
      if (flushTimer !== null || rafId !== null) return;
      const wait = Math.max(0, FLUSH_INTERVAL_MS - (Date.now() - lastFlushAt));
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          lastFlushAt = Date.now();
          // 사고 요약만 온 구간도 반영해야 '사고 중…'이 실시간으로 보인다.
          if (buffered || bufferedThink || bufferedError) applyBuffered(false);
        });
      }, wait);
    };

    // 청크를 마커 기준으로 갈라 담는다. 마커는 1글자라 청크 경계에서 쪼개질 수 없고,
    // 상태(inThinking/inError)는 청크를 넘어 유지된다.
    const consume = (chunk: string) => {
      let rest = chunk;
      while (rest) {
        if (inError) {
          bufferedError += rest;
          break;
        }
        const thinkMarker = inThinking ? THINK_CLOSE : THINK_OPEN;
        const atThink = rest.indexOf(thinkMarker);
        const atError = rest.indexOf(ERROR_MARK);
        const at =
          atThink === -1 ? atError : atError === -1 ? atThink : Math.min(atThink, atError);
        if (at === -1) {
          if (inThinking) bufferedThink += rest;
          else buffered += rest;
          break;
        }
        const head = rest.slice(0, at);
        if (inThinking) bufferedThink += head;
        else buffered += head;
        rest = rest.slice(at + 1);
        if (at === atError) {
          inError = true;
          inThinking = false;
        } else {
          inThinking = !inThinking;
        }
      }
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          webSearch: settings.webSearch,
          depth: settings.depth,
          mode,
          conversationId: convId,
          // 오류 말풍선(⚠️)은 모델에 보내지 않는다 — 가짜 문맥 오염 방지.
          // errorNote 도 보내지 않는다 (content 만 실린다).
          messages: history.filter((m) => !m.error).map((m) => ({
            role: m.role,
            content: m.content,
            // 데이터가 있는 첨부만 전송 (복원된 메타데이터 전용 첨부는 제외)
            attachments: m.attachments
              ?.filter((a) => a.data || a.fileId)
              .map((a) =>
                a.fileId
                  ? { kind: "file", name: a.name, mediaType: a.mediaType, fileId: a.fileId }
                  : { kind: "inline", name: a.name, mediaType: a.mediaType, data: a.data },
              ),
          })),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(await readApiError(res, "응답을 받지 못했습니다."));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
        scheduleFlush();
      }

      cancelScheduledFlush();
      // 마무리 커밋은 답변 전체의 마크다운 파싱을 유발한다 — transition으로
      // 낮은 우선순위 처리해 긴 답변에서도 입력·스크롤이 막히지 않게 한다.
      startTransition(() => applyBuffered(true));
    } catch (err) {
      cancelScheduledFlush();
      if (err instanceof DOMException && err.name === "AbortError") {
        // 사용자가 중지 — 부분 응답은 그대로 두고, 아무것도 못 받았으면 말풍선 제거
        setMessages((prev) => {
          const idx = prev.findLastIndex((m) => m.id === assistantId);
          if (idx < 0) return prev;
          const cur = prev[idx];
          const nextContent = cur.content + buffered;
          const nextThinking = (cur.thinking ?? "") + bufferedThink;
          buffered = "";
          bufferedThink = "";
          bufferedError = "";
          const copy = [...prev];
          // 사고만 오고 본문이 없는 채로 중지된 경우도 '아무것도 못 받음'으로 본다
          // (사고 요약만 남은 말풍선은 사용자에게 의미가 없다).
          if (cur.role === "assistant" && nextContent === "") {
            copy.splice(idx, 1);
            return copy;
          }
          copy[idx] = {
            ...cur,
            content: nextContent,
            thinking: nextThinking || undefined,
            streaming: false,
          };
          return copy;
        });
      } else {
        const msg = err instanceof Error ? err.message : "오류가 발생했습니다.";
        buffered = "";
        bufferedThink = "";
        bufferedError = "";
        setMessages((prev) => {
          const idx = prev.findLastIndex((m) => m.id === assistantId);
          if (idx < 0) return prev;
          const copy = [...prev];
          copy[idx] = {
            ...prev[idx],
            role: "assistant",
            content: `⚠️ ${msg}`,
            error: true,
            streaming: false,
          };
          return copy;
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      onTurnEnd();
    }
  }

  return { loading, streamTurn, stopGenerating };
}
