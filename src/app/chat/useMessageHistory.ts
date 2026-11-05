"use client";

import { useRef, useState, type RefObject } from "react";
import { rowsToMessages, type Message, type MessageRow } from "./types";

/**
 * 현재 대화의 메시지 목록. 긴 대화는 최근 페이지만 불러오고 위쪽은 버튼으로 이어 받는다.
 * stickRef: 대화를 열면 마지막 메시지로 내려가도록 자동 스크롤을 켠다.
 * mainRef: '이전 더 보기'로 위에 붙인 높이만큼 스크롤을 보정한다.
 */
export function useMessageHistory(
  stickRef: RefObject<boolean>,
  mainRef: RefObject<HTMLElement | null>,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // 대화를 여는 중 — 이 동안 전송을 막는다. 안 막으면 뒤늦게 끝난 로드가 방금 보낸
  // 질문·답변 말풍선을 덮어쓰고, 모델에는 이전 문맥 없이 전송된다.
  const [loadingMessages, setLoadingMessages] = useState(false);
  // 화면에 로드된 가장 오래된 메시지의 created_at — '이전 대화 더 보기' 커서
  const oldestCursor = useRef<string | null>(null);
  // 메시지 로드 세대 — 대화를 바꾸면 증가시켜, 뒤늦게 도착한 이전 대화의
  // 응답이 현재 화면을 덮어쓰지 않게 한다.
  const loadSeq = useRef(0);

  /** 화면을 비우고 진행 중이던 로드를 무효화한다 (새 대화·삭제 후). */
  function reset() {
    loadSeq.current += 1;
    oldestCursor.current = null;
    setHasMoreOlder(false);
    setLoadingMessages(false);
    setMessages([]);
  }

  async function load(conversationId: string) {
    const seq = ++loadSeq.current;
    setLoadingMessages(true);
    try {
      const res = await fetch(
        `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
      );
      if (seq !== loadSeq.current) return; // 그 사이 다른 대화로 이동함
      if (!res.ok) {
        setMessages([]);
        setHasMoreOlder(false);
        return;
      }
      const { messages: rows, hasMore } = (await res.json()) as {
        messages: MessageRow[];
        hasMore: boolean;
      };
      if (seq !== loadSeq.current) return;
      oldestCursor.current = rows[0]?.created_at ?? null;
      setHasMoreOlder(hasMore);
      stickRef.current = true; // 대화를 열면 마지막 메시지로
      setMessages(rowsToMessages(rows));
    } catch {
      if (seq === loadSeq.current) {
        setMessages([]);
        setHasMoreOlder(false);
      }
    } finally {
      if (seq === loadSeq.current) setLoadingMessages(false);
    }
  }

  // 위쪽(과거) 메시지 한 페이지를 이어 붙인다 — 보던 스크롤 위치는 유지.
  async function loadOlder(conversationId: string | null) {
    const cursor = oldestCursor.current;
    if (!conversationId || !cursor || loadingOlder) return;
    const seq = loadSeq.current;
    setLoadingOlder(true);
    const el = mainRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      const res = await fetch(
        `/api/messages?conversationId=${encodeURIComponent(conversationId)}&before=${encodeURIComponent(cursor)}`,
      );
      if (seq !== loadSeq.current || !res.ok) return;
      const { messages: rows, hasMore } = (await res.json()) as {
        messages: MessageRow[];
        hasMore: boolean;
      };
      if (seq !== loadSeq.current) return;
      setHasMoreOlder(hasMore);
      if (rows.length > 0) {
        oldestCursor.current = rows[0]?.created_at ?? null;
        setMessages((prev) => [...rowsToMessages(rows), ...prev]);
        // 프리펜드된 높이만큼 스크롤을 보정해 읽던 위치를 지킨다.
        requestAnimationFrame(() => {
          const m = mainRef.current;
          if (m) m.scrollTop = prevTop + (m.scrollHeight - prevHeight);
        });
      }
    } catch {
      /* 실패해도 무해 — 버튼을 다시 누르면 재시도 */
    } finally {
      setLoadingOlder(false);
    }
  }

  return {
    messages,
    setMessages,
    hasMoreOlder,
    loadingOlder,
    loadingMessages,
    load,
    loadOlder,
    reset,
  };
}
