"use client";

import { memo, startTransition, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  ACCEPT,
  INLINE_MAX_BYTES,
  formatBytes,
  isAllowedType,
  maxBytesFor,
} from "@/lib/attachments";
import {
  MODELS,
  THINKING_DEPTHS,
  DEFAULT_THINKING_DEPTH,
  type ThinkingDepth,
} from "@/lib/ai/models";
import Markdown from "./Markdown";
import { THINK_CLOSE, THINK_OPEN } from "@/lib/streamMarkers";

// 이 거리 안이면 '바닥에 있다'고 본다. 자동 따라가기 여부와 '맨 아래로' 버튼
// 노출을 함께 결정한다. 너무 크면 위로 조금 올려도 계속 끌려가고, 너무 작으면
// 바닥에 있어도 따라가지 않는다.
const BOTTOM_GAP_PX = 80;

type Conversation = { id: string; title: string; updated_at: string };

type UIAttachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  data?: string; // 작은 파일: base64 인라인
  fileId?: string; // 큰 파일: Files API 참조
  previewUrl?: string; // 이미지 미리보기용 objectURL (전송하지 않음)
  uploading?: boolean; // Blob+Files 업로드 진행 중
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: UIAttachment[];
  error?: boolean;
  streaming?: boolean;
  // 사고 요약 — 화면 표시 전용이라 DB에 저장하지 않고 새로고침하면 사라진다.
  thinking?: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,XXXX"
      resolve(res.slice(res.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// /api/messages 가 돌려주는 행
type MessageRow = {
  role: "user" | "assistant";
  content: string;
  attachments: { name: string; type: string; fileId?: string }[] | null;
  created_at: string;
};

function rowsToMessages(rows: MessageRow[]): Message[] {
  return rows.map((r) => ({
    id: crypto.randomUUID(),
    role: r.role,
    content: r.content,
    attachments: Array.isArray(r.attachments)
      ? r.attachments.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          mediaType: a.type,
          size: 0,
          // Files API 첨부는 fileId를 복원해 새로고침 후에도
          // 후속 질문에서 파일 문맥이 유지되게 한다.
          fileId: typeof a.fileId === "string" ? a.fileId : undefined,
        }))
      : undefined,
  }));
}

export default function ChatClient() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>(MODELS[0].id);
  // 웹 검색은 기본 켬 — 아래 토글 버튼으로 끌 수 있다 (Claude·GPT 모두 지원)
  const [webSearch, setWebSearch] = useState(true);
  // 대화 목록 검색어 (제목 + 메시지 본문을 서버에서 함께 찾는다)
  const [convSearch, setConvSearch] = useState("");
  const convSearchRef = useRef("");
  const convSearchFirstRun = useRef(true);
  const [depth, setDepth] = useState<ThinkingDepth>(DEFAULT_THINKING_DEPTH);
  const [editPending, setEditPending] = useState(false); // 다음 전송이 '마지막 턴 수정'인지
  const [pending, setPending] = useState<UIAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 긴 대화는 최근 페이지만 렌더링하고, 위쪽은 버튼으로 이어 불러온다.
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const mainRef = useRef<HTMLElement>(null);
  const stickToBottom = useRef(true); // 사용자가 바닥 근처에 있을 때만 자동 스크롤
  // '맨 아래로' 버튼 노출용 — 자동 스크롤 판단은 위 ref 가, 화면 표시는 이 state 가 맡는다
  const [atBottom, setAtBottom] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  // 붙여넣은 이미지의 순번 — 이름 없는 클립보드 비트맵을 구분하기 위한 것
  const pasteCounter = useRef(0);
  // 화면에 로드된 가장 오래된 메시지의 created_at — '이전 대화 더 보기' 커서
  const oldestCursor = useRef<string | null>(null);
  // 메시지 로드 세대 — 대화를 바꾸면 증가시켜, 뒤늦게 도착한 이전 대화의
  // 응답이 현재 화면을 덮어쓰지 않게 한다.
  const loadSeq = useRef(0);
  // 이중 전송 방지 — loading은 React 상태라 streamTurn 안에서 비동기로 켜진다.
  // 그 사이(대화 생성 await 등) 두 번째 트리거가 stale한 loading=false를 보고
  // 통과하면 질문·답변·DB 저장이 2번씩 일어난다. ref는 동기적으로 즉시 읽혀
  // 이 경쟁을 막는다. (Enter 연타·더블클릭·한글 IME 중복 keydown 대비)
  const sendingRef = useRef(false);

  // 첫 로드: 대화 목록을 불러와 가장 최근 대화를 자동 선택
  useEffect(() => {
    (async () => {
      const list = await refreshConversations();
      if (list.length > 0) {
        setActiveConversationId(list[0].id);
        void loadMessages(list[0].id);
      }
    })();
  }, []);

  // 자동 스크롤 — 사용자가 위로 스크롤해 읽는 중이면 방해하지 않는다.
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = mainRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function nearBottom(el: HTMLElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_GAP_PX;
  }

  function onMainScroll() {
    const el = mainRef.current;
    if (!el) return;
    const near = nearBottom(el);
    stickToBottom.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }

  // 휠·터치는 "사용자가 직접 스크롤을 잡았다"는 확실한 신호다. 위치만으로 판단하면
  // 자동 따라가기가 일으킨 scroll 이벤트와 구분되지 않아, 위로 올려도 다음 토큰이
  // 도착하는 순간 다시 바닥으로 끌려갈 수 있다. 여기서 먼저 끊어 준다.
  function onUserScrollIntent() {
    const el = mainRef.current;
    if (el && !nearBottom(el)) stickToBottom.current = false;
  }

  function scrollToBottom() {
    const el = mainRef.current;
    if (!el) return;
    // atBottom 은 여기서 미리 켜지 않는다. 스크롤이 실제로 끝났을 때 onMainScroll
    // 이 갱신하게 두어야, 스크롤이 중간에 막히거나 취소돼도 버튼만 사라지고
    // 위치는 그대로인 상태가 생기지 않는다.
    stickToBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // ── 대화 목록/메시지 ──────────────────────────
  // 검색어는 ref로도 들고 있는다 — refreshConversations 는 목록 갱신이 필요한
  // 여러 곳(새 대화·삭제·전송 후)에서 불리는데, 그때마다 최신 검색어를 봐야 한다.
  async function refreshConversations(): Promise<Conversation[]> {
    try {
      const q = convSearchRef.current.trim();
      const res = await fetch(
        q ? `/api/conversations?q=${encodeURIComponent(q)}` : "/api/conversations",
      );
      if (!res.ok) return [];
      const list = (await res.json()) as Conversation[];
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }

  // 검색어 변경 시 목록 재조회 — 입력 중 매 글자마다 조회하지 않도록 디바운스.
  // 최초 마운트에서는 별도의 초기 로드가 이미 돌므로 건너뛴다.
  useEffect(() => {
    convSearchRef.current = convSearch;
    if (convSearchFirstRun.current) {
      convSearchFirstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void refreshConversations();
    }, 250);
    return () => clearTimeout(timer);
    // refreshConversations 는 ref로 최신 검색어를 읽으므로 의존성이 필요 없다.
  }, [convSearch]);

  async function loadMessages(conversationId: string) {
    const seq = ++loadSeq.current;
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
      stickToBottom.current = true; // 대화를 열면 마지막 메시지로
      setMessages(rowsToMessages(rows));
    } catch {
      if (seq === loadSeq.current) {
        setMessages([]);
        setHasMoreOlder(false);
      }
    }
  }

  // 위쪽(과거) 메시지 한 페이지를 이어 붙인다 — 보던 스크롤 위치는 유지.
  async function loadOlderMessages() {
    const convId = activeConversationId;
    const cursor = oldestCursor.current;
    if (!convId || !cursor || loadingOlder) return;
    const seq = loadSeq.current;
    setLoadingOlder(true);
    const el = mainRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      const res = await fetch(
        `/api/messages?conversationId=${encodeURIComponent(convId)}&before=${encodeURIComponent(cursor)}`,
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

  function newConversation() {
    loadSeq.current += 1; // 진행 중이던 이전 대화 로드를 무효화
    oldestCursor.current = null;
    setHasMoreOlder(false);
    setActiveConversationId(null);
    setMessages([]);
    setPending([]);
    setInput("");
    setAttachError(null);
    setEditPending(false);
    setSidebarOpen(false);
  }

  function selectConversation(id: string) {
    setSidebarOpen(false);
    if (id === activeConversationId) return;
    setActiveConversationId(id);
    setPending([]);
    setInput("");
    setAttachError(null);
    setEditPending(false);
    void loadMessages(id);
  }

  async function deleteConversation(id: string) {
    try {
      await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      /* noop */
    }
    const list = await refreshConversations();
    if (id === activeConversationId) {
      if (list.length > 0) {
        setActiveConversationId(list[0].id);
        void loadMessages(list[0].id);
      } else {
        loadSeq.current += 1;
        oldestCursor.current = null;
        setHasMoreOlder(false);
        setActiveConversationId(null);
        setMessages([]);
      }
    }
  }

  // 휴지통 버튼은 즉시 삭제하지 않고 확인 모달을 띄운다 (실수 방지)
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteConversation(deleteTarget.id);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // ── 첨부 ──────────────────────────────────────
  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    // 이전 오류는 여기서 한 번만 지운다. 아래 성공 경로에서 매번 지우면,
    // 정상 파일과 거부된 파일을 함께 넣었을 때 거부 사유가 화면에 남지 않는다.
    setAttachError(null);

    for (const file of files) {
      if (!isAllowedType(file.type)) {
        setAttachError(`지원하지 않는 형식입니다: ${file.name}`);
        continue;
      }
      // 텍스트는 내용이 그대로 토큰이 되므로 상한이 더 낮다 (attachments.ts 참고)
      const limit = maxBytesFor(file.type);
      if (file.size > limit) {
        setAttachError(`${formatBytes(limit)}를 초과했습니다: ${file.name}`);
        continue;
      }

      const id = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;

      if (file.size <= INLINE_MAX_BYTES) {
        try {
          const data = await fileToBase64(file);
          setPending((prev) => [
            ...prev,
            { id, name: file.name, mediaType: file.type, size: file.size, data, previewUrl },
          ]);
        } catch {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setAttachError(`파일을 읽지 못했습니다: ${file.name}`);
        }
      } else {
        setPending((prev) => [
          ...prev,
          { id, name: file.name, mediaType: file.type, size: file.size, previewUrl, uploading: true },
        ]);
        try {
          const blob = await upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/blob",
          });
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: blob.url,
              name: file.name,
              mediaType: file.type,
            }),
          });
          if (!res.ok) {
            let msg = "업로드에 실패했습니다.";
            try {
              const d = await res.json();
              if (d?.error) msg = d.error;
            } catch {
              /* noop */
            }
            throw new Error(msg);
          }
          const { fileId } = (await res.json()) as { fileId: string };
          setPending((prev) =>
            prev.map((p) => (p.id === id ? { ...p, fileId, uploading: false } : p)),
          );
        } catch (err) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setPending((prev) => prev.filter((p) => p.id !== id));
          setAttachError(
            err instanceof Error ? err.message : `업로드 실패: ${file.name}`,
          );
        }
      }
    }
  }

  function removeAttachment(id: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  // ── 전송/재생성/수정 공통 스트리밍 ──────────────
  // history 는 반드시 user 메시지로 끝나야 한다.
  async function streamTurn(
    convId: string | null,
    history: Message[],
    mode: "normal" | "edit" | "regenerate",
  ) {
    setLoading(true);
    stickToBottom.current = true; // 전송 시엔 항상 바닥으로
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    let rafId: number | null = null;
    let flushTimer: number | null = null;
    let lastFlushAt = 0;
    let buffered = "";
    // 사고 요약은 본문과 다른 영역에 쌓는다. 서버가 THINK_OPEN/CLOSE 마커로
    // 구간을 표시해 보내므로, 아래 읽기 루프에서 상태를 보며 갈라 담는다.
    let bufferedThink = "";
    let inThinking = false;
    // 토큰 반영 주기 — 매 프레임(초당 60회) 대신 이 간격으로 묶어 반영한다.
    // 답변이 길어질수록 말풍선 레이아웃 비용이 커지는데, 반영 횟수를 줄이면
    // 그 비용이 1/6로 떨어져 스트리밍 중에도 화면이 매끄럽게 유지된다.
    const FLUSH_INTERVAL_MS = 100;

    const applyBuffered = (finalize: boolean) => {
      const delta = buffered;
      const deltaThink = bufferedThink;
      buffered = "";
      bufferedThink = "";
      setMessages((prev) => {
        const copy = [...prev];
        let idx = -1;
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i]?.id === assistantId) {
            idx = i;
            break;
          }
        }
        if (idx < 0) return prev;
        const cur = copy[idx];
        copy[idx] = {
          ...cur,
          content: cur.content + delta,
          thinking: deltaThink ? (cur.thinking ?? "") + deltaThink : cur.thinking,
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
          if (buffered) applyBuffered(false);
        });
      }, wait);
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          webSearch,
          depth,
          mode,
          conversationId: convId,
          // 오류 말풍선(⚠️)은 모델에 보내지 않는다 — 가짜 문맥 오염 방지
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
        let msg = "응답을 받지 못했습니다.";
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {
          /* JSON이 아니면 기본 메시지 사용 */
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // 마커를 기준으로 본문/사고로 갈라 담는다. 마커는 1글자라 청크 경계에서
        // 쪼개질 수 없고, 상태(inThinking)는 청크를 넘어 유지된다.
        let rest = chunk;
        while (rest) {
          const marker = inThinking ? THINK_CLOSE : THINK_OPEN;
          const at = rest.indexOf(marker);
          if (at === -1) {
            if (inThinking) bufferedThink += rest;
            else buffered += rest;
            break;
          }
          const head = rest.slice(0, at);
          if (inThinking) bufferedThink += head;
          else buffered += head;
          rest = rest.slice(at + marker.length);
          inThinking = !inThinking;
        }
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
          const copy = [...prev];
          let idx = -1;
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i]?.id === assistantId) {
              idx = i;
              break;
            }
          }
          if (idx < 0) return prev;
          const cur = copy[idx];
          const nextContent = cur.content + buffered;
          const nextThinking = (cur.thinking ?? "") + bufferedThink;
          buffered = "";
          bufferedThink = "";
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
        setMessages((prev) => {
          const copy = [...prev];
          let idx = -1;
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i]?.id === assistantId) {
              idx = i;
              break;
            }
          }
          if (idx < 0) return prev;
          const cur = copy[idx];
          buffered = "";
          copy[idx] = {
            ...cur,
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
      void refreshConversations(); // 새 대화/제목/순서 반영
      // 첫 문답의 제목은 응답 종료 후 서버가 비동기로 생성 — 잠시 뒤 한 번 더 반영
      setTimeout(() => void refreshConversations(), 3000);
    }
  }

  // ── 전송 ──────────────────────────────────────
  async function send() {
    if (sendingRef.current) return; // 이미 전송 처리 중 — 이중 전송 차단(동기)
    const text = input.trim();
    const uploadingNow = pending.some((p) => p.uploading);
    if ((text === "" && pending.length === 0) || loading || uploadingNow) return;
    sendingRef.current = true;
    try {
      // 1) 대화 확보 — 없으면 새로 생성 (실패해도 채팅은 진행, 저장만 생략)
      let convId = activeConversationId;
      if (!convId) {
        try {
          const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ firstMessage: text }),
          });
          if (res.ok) {
            const conv = (await res.json()) as { id: string };
            convId = conv.id;
            setActiveConversationId(convId);
            void refreshConversations();
          }
        } catch {
          /* Supabase 미설정 등 — 저장 없이 진행 */
        }
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        attachments: pending.length ? pending : undefined,
      };
      const nextMessages: Message[] = [...messages, userMsg];

      setMessages(nextMessages);
      setInput("");
      setPending([]);
      setAttachError(null);

      const mode = editPending ? "edit" : "normal";
      setEditPending(false);
      await streamTurn(convId, nextMessages, mode);
    } finally {
      sendingRef.current = false;
    }
  }

  // 마지막 assistant 응답을 버리고 같은 질문으로 다시 생성
  async function regenerate() {
    if (sendingRef.current || loading) return; // 이중 실행 차단(동기)
    const history = [...messages];
    while (history.length && history[history.length - 1].role === "assistant") {
      history.pop();
    }
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      return;
    }
    sendingRef.current = true;
    try {
      setMessages(history);
      await streamTurn(activeConversationId, history, "regenerate");
    } finally {
      sendingRef.current = false;
    }
  }

  // 마지막 사용자 메시지를 입력창으로 되돌려 수정 후 재전송.
  // (첨부는 복원하지 않음 — 필요하면 다시 첨부)
  function editMessage(index: number) {
    if (loading) return;
    const target = messages[index];
    if (!target || target.role !== "user") return;
    setInput(target.content);
    setMessages(messages.slice(0, index));
    setEditPending(true);
    textareaRef.current?.focus();
  }

  // 응답 생성 중지 — 서버는 끊김을 감지해 부분 응답까지 저장한다.
  function stopGenerating() {
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  // ── 드래그앤드롭 ──────────────────────────────
  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }
  function onDragEnter(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragActive(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  }

  // ── 클립보드 붙여넣기 ─────────────────────────
  // 파일 선택·드래그앤드롭과 같은 addFiles 경로를 타므로 형식·크기 검사와
  // 인라인/Blob 분기가 그대로 적용된다. 스크린샷(Win+Shift+S 등)을 저장 없이
  // 바로 올릴 수 있는 게 주 용도다.
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;

      // 브라우저는 클립보드 비트맵에 이름을 안 주거나 전부 'image.png' 로 준다.
      // 그대로 두면 첨부 목록에서 구분이 안 되므로 순번을 붙인다.
      // 파일 관리자에서 복사한 실제 파일은 이름이 있으므로 그대로 둔다.
      const generic = !file.name || file.name === "image.png";
      if (!generic) {
        files.push(file);
        continue;
      }
      pasteCounter.current += 1;
      const ext = file.type.split("/")[1]?.split("+")[0] || "png";
      files.push(
        new File([file], `붙여넣은 이미지 ${pasteCounter.current}.${ext}`, {
          type: file.type,
        }),
      );
    }

    // 이미지가 없으면 기본 동작(텍스트 붙여넣기)을 막지 않는다.
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  }

  const isEmpty = messages.length === 0;
  const uploading = pending.some((p) => p.uploading);
  const canSend =
    !loading && !uploading && (input.trim() !== "" || pending.length > 0);

  const currentModel = MODELS.find((m) => m.id === model);
  const isAnthropic = currentModel?.provider === "anthropic";
  // 사고 깊이는 adaptive thinking 지원 모델(Sonnet 5·Opus 4.8)에서만 의미가 있다.
  const supportsDepth = currentModel?.adaptiveThinking === true;

  // 마지막 user 메시지 위치 — 수정 버튼은 여기에만 표시
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  // GPT 모델은 Files API 첨부(2MB 초과)를 읽지 못한다 — 조용히 무시되므로 경고
  const gptFileWarning =
    !isAnthropic &&
    (pending.some((p) => p.fileId) ||
      messages.some((m) => m.attachments?.some((a) => a.fileId)));

  return (
    // 채팅 화면은 뷰포트 높이에 고정 — 대화가 길어져도 문서 전체가 스크롤되지
    // 않도록 해, 사이드바(대화 목록)와 헤더/입력창이 항상 제자리에 머물게 한다.
    // (공유 body 는 min-h-full 이라 admin 페이지의 문서 스크롤은 그대로 유지)
    <div className="flex h-dvh overflow-hidden">
      {/* 모바일 백드롭 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 사이드바 */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-20 flex w-64 transform flex-col border-r border-line bg-surface shadow-xl transition-transform md:static md:z-auto md:translate-x-0 md:shadow-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={newConversation}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-raised px-3 py-2.5 text-sm font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-accent/40 hover:text-accent"
          >
            <IconPlus />새 대화
          </button>
        </div>
        <div className="px-4 pb-2.5">
          <input
            type="search"
            value={convSearch}
            onChange={(e) => setConvSearch(e.target.value)}
            placeholder="대화 검색"
            aria-label="대화 검색"
            className="w-full rounded-lg border border-line bg-raised px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-accent/40"
          />
        </div>
        <p className="px-5 pb-1.5 text-[11px] font-medium tracking-wider text-muted/80">
          {convSearch.trim() ? "검색 결과" : "대화 목록"}
        </p>
        <nav className="nice-scroll flex-1 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted/70">
              {convSearch.trim() ? "검색 결과가 없습니다" : "대화가 없습니다"}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((c) => {
                const active = c.id === activeConversationId;
                return (
                  <li
                    key={c.id}
                    className={[
                      "group flex items-center rounded-lg transition-colors",
                      active
                        ? "bg-accent-soft text-foreground"
                        : "text-foreground/75 hover:bg-foreground/[.05] hover:text-foreground",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => selectConversation(c.id)}
                      className="flex-1 truncate px-3 py-2 text-left text-sm"
                      title={c.title}
                    >
                      {c.title}
                    </button>
                    {/*
                      모바일에는 hover가 없다. hidden + group-hover:flex 로 두면
                      터치 기기에서 삭제 버튼에 영영 닿을 수 없으므로, 메시지 액션과
                      같은 방식으로 md 이상에서만 hover(및 키보드 포커스)로 감춘다.
                    */}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(c)}
                      aria-label="대화 삭제"
                      title="삭제"
                      className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-opacity hover:bg-foreground/[.06] hover:text-red-500 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                    >
                      <IconTrash />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      {/* 채팅 영역 */}
      {/*
        min-w-0 은 필수. flex 아이템의 기본값 min-width:auto 는 내용의 최소 너비보다
        작게 줄어들지 못하게 하는데, 긴 코드 한 줄이나 넓은 수식이 들어오면 이 칼럼이
        화면보다 넓게 벌어진다. 상위 컨테이너가 overflow-hidden 이라 넘친 부분은
        스크롤로도 볼 수 없고, 좌측 패딩까지 화면 밖으로 밀려 본문이 잘린다.
      */}
      <div
        className="relative flex min-w-0 flex-1 flex-col font-sans"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 헤더 */}
        <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="대화 목록"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-foreground/[.05] hover:text-foreground md:hidden"
          >
            <IconMenu />
          </button>
          <span className="flex h-7 w-7 select-none items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-[11px] font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
            UZ
          </span>
          <h1 className="text-[15px] font-semibold tracking-tight">UZ Chat</h1>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            우찌 전용
          </span>
        </header>

        {/* 메시지 영역 */}
        <main
          ref={mainRef}
          onScroll={onMainScroll}
          onWheel={onUserScrollIntent}
          onTouchMove={onUserScrollIntent}
          className="nice-scroll flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
            {isEmpty && (
              <div className="mt-24 flex flex-col items-center text-center">
                <span className="flex h-12 w-12 select-none items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-lg font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
                  UZ
                </span>
                <p className="mt-5 text-2xl font-semibold tracking-tight">
                  무엇이든 물어보세요
                </p>
                <p className="mt-2 text-sm text-muted">
                  Claude 기반 한국어 어시스턴트 · 이미지·PDF를 끌어다 놓아 보세요
                </p>
              </div>
            )}

            {hasMoreOlder && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOlderMessages()}
                  disabled={loadingOlder}
                  className="rounded-full border border-line bg-raised px-4 py-1.5 text-xs text-muted transition-colors hover:text-accent disabled:opacity-50"
                >
                  {loadingOlder ? "불러오는 중…" : "↑ 이전 대화 더 보기"}
                </button>
              </div>
            )}

            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                onEdit={
                  !loading && !editPending && m.role === "user" && i === lastUserIndex
                    ? () => editMessage(i)
                    : undefined
                }
                onRegenerate={
                  !loading &&
                  !editPending &&
                  m.role === "assistant" &&
                  i === messages.length - 1 &&
                  m.content !== ""
                    ? () => void regenerate()
                    : undefined
                }
              />
            ))}

            {loading &&
              messages.length > 0 &&
              messages[messages.length - 1].role === "assistant" &&
              messages[messages.length - 1].content === "" && (
                <div className="flex justify-start py-1">
                  <TypingDots />
                </div>
              )}

          </div>
        </main>

        {/* 맨 아래로 — 위로 올려 읽는 중일 때만 나타난다 */}
        {!atBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="맨 아래로"
            title="맨 아래로"
            className="absolute bottom-32 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-raised text-muted shadow-[0_2px_8px_rgba(0,0,0,0.14)] transition-colors hover:border-accent/40 hover:text-accent"
          >
            <IconArrowDown />
          </button>
        )}

        {/* 입력 영역 */}
        <footer className="px-4 pb-4 pt-1">
          <div className="mx-auto max-w-3xl">
            {(attachError || gptFileWarning) && (
              <p
                className={[
                  "mb-1.5 px-2 text-xs",
                  attachError
                    ? "text-red-500"
                    : "text-amber-600 dark:text-amber-400",
                ].join(" ")}
              >
                {attachError ?? "GPT 모델은 2MB 초과 첨부를 읽지 못합니다"}
              </p>
            )}

            <div className="rounded-2xl border border-line bg-raised shadow-[0_2px_16px_rgba(0,0,0,0.05)] transition-colors focus-within:border-foreground/25">
              {pending.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {pending.map((a) => (
                    <div key={a.id} className="relative">
                      <AttachmentPreview att={a} />
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        aria-label="첨부 제거"
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-xs text-background shadow transition-opacity hover:opacity-80"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                disabled={loading}
                rows={1}
                placeholder="무엇이든 물어보세요"
                className="max-h-[200px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-6 outline-none placeholder:text-muted/60 disabled:opacity-60"
              />

              <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  aria-label="파일 첨부"
                  title="파일 첨부 (이미지·PDF)"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-foreground/[.05] hover:text-foreground disabled:opacity-40"
                >
                  <IconPaperclip />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />

                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  aria-label="모델 선택"
                  className="h-8 max-w-44 rounded-lg bg-transparent px-1.5 text-xs text-muted outline-none transition-colors hover:bg-foreground/[.05] hover:text-foreground"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>

                {supportsDepth && (
                  <select
                    value={depth}
                    onChange={(e) => setDepth(e.target.value as ThinkingDepth)}
                    aria-label="사고 깊이"
                    title="빠르게: 최소 지연 · 표준·깊게: 뒤로 갈수록 더 신중히 사고하고 답이 느려집니다"
                    className="h-8 rounded-lg bg-transparent px-1.5 text-xs text-muted outline-none transition-colors hover:bg-foreground/[.05] hover:text-foreground"
                  >
                    {THINKING_DEPTHS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => setWebSearch((v) => !v)}
                  aria-pressed={webSearch}
                  title={
                    webSearch
                      ? "웹 검색 켜짐 — 필요할 때 웹을 검색해 답합니다. 누르면 꺼집니다"
                      : "웹 검색 꺼짐 — 누르면 켜집니다"
                  }
                  className={[
                    "flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors",
                    webSearch
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:bg-foreground/[.05] hover:text-foreground",
                  ].join(" ")}
                >
                  <IconGlobe />웹 검색
                </button>

                <div className="ml-auto pl-1">
                  {loading ? (
                    <button
                      type="button"
                      onClick={stopGenerating}
                      aria-label="응답 중지"
                      title="응답 중지"
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-foreground transition-colors hover:bg-foreground/[.05]"
                    >
                      <IconStop />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={!canSend}
                      aria-label="전송"
                      title={uploading ? "업로드 중…" : "전송"}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-colors hover:bg-accent-strong disabled:opacity-35 disabled:shadow-none"
                    >
                      {uploading ? <IconSpinner /> : <IconArrowUp />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-2 hidden text-center text-[11px] text-muted/60 sm:block">
              Enter 전송 · Shift+Enter 줄바꿈
            </p>
          </div>
        </footer>

        {/* 드롭 오버레이 */}
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-accent/50 bg-raised px-8 py-6 text-center shadow-xl">
              <p className="text-lg font-medium">여기에 파일을 놓으세요</p>
              <p className="mt-1 text-sm text-muted">
                이미지(PNG·JPG·WebP·GIF) 또는 PDF · 파일당 최대 32MB
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-raised p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">대화를 삭제할까요?</h2>
            <p className="mt-2 text-sm text-muted">
              <b className="break-words text-foreground">{deleteTarget.title}</b>
              <br />이 대화의 모든 메시지가 영구 삭제되며 되돌릴 수 없습니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border border-line px-4 py-2 text-sm transition-colors hover:bg-foreground/[.05] disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
              >
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  onEdit,
  onRegenerate,
}: {
  message: Message;
  onEdit?: () => void;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 사용 불가(비보안 컨텍스트 등) — 무시 */
    }
  }

  const showCopy = message.content !== "" && !message.error;

  return (
    <div
      className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-3xl rounded-br-lg bg-bubble px-4 py-2.5 text-[15px] leading-7 text-bubble-fg shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
            : message.error
              ? "max-w-[85%] rounded-2xl border border-red-500/25 bg-red-500/[.07] px-4 py-3 text-[15px] leading-7 text-red-600 dark:text-red-400"
              : "w-full text-[15px] leading-7 text-foreground"
        }
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <AttachmentPreview key={a.id} att={a} />
            ))}
          </div>
        )}
        {!isUser && message.thinking && (
          <details
            // 사고 중에는 펼쳐 둬 긴 침묵 대신 진행 상황이 보이게 하고,
            // 본문이 시작되면 접어 답변을 가리지 않게 한다.
            open={!!message.streaming && !message.content}
            className="mb-2 rounded-xl border border-foreground/10 bg-foreground/[.03] px-3 py-2"
          >
            <summary className="cursor-pointer select-none text-xs font-medium text-muted">
              {message.streaming && !message.content ? "사고 중…" : "사고 과정"}
            </summary>
            <div className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-muted">
              {message.thinking}
            </div>
          </details>
        )}
        {message.content &&
          (isUser || message.error || message.streaming ? (
            <div className="whitespace-pre-wrap">
              {message.content}
              {message.streaming && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-accent align-[-2px]"
                />
              )}
            </div>
          ) : (
            <Markdown content={message.content} />
          ))}
      </div>
      {(showCopy || onEdit || onRegenerate) && (
        <div className="mt-1.5 flex gap-1 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {showCopy && (
            <button
              type="button"
              onClick={copy}
              aria-label="메시지 복사"
              className="rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-foreground/[.05] hover:text-foreground"
            >
              {copied ? "복사됨 ✓" : "복사"}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="메시지 수정"
              title="이 메시지를 수정해 다시 보냅니다"
              className="rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-foreground/[.05] hover:text-foreground"
            >
              수정
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              aria-label="응답 재생성"
              title="이 응답을 버리고 다시 생성합니다"
              className="rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-foreground/[.05] hover:text-foreground"
            >
              재생성
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function AttachmentPreview({ att }: { att: UIAttachment }) {
  const isImage = att.mediaType.startsWith("image/");
  const isPdf = att.mediaType === "application/pdf";
  const src =
    att.previewUrl ??
    (att.data ? `data:${att.mediaType};base64,${att.data}` : undefined);

  // 이미지이고 미리보기 소스가 있으면 썸네일
  if (isImage && src) {
    return (
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={att.name}
          className="h-20 w-20 rounded-xl border border-line object-cover"
        />
        {att.uploading && <UploadingOverlay />}
      </div>
    );
  }

  // 그 외(복원된 첨부 포함): 파일 칩
  return (
    <div className="relative flex h-20 w-32 flex-col justify-center gap-1 rounded-xl border border-line bg-raised px-3">
      <span className="text-xl">{isPdf ? "📄" : "📎"}</span>
      <span className="truncate text-xs text-muted">{att.name}</span>
      {att.uploading && <UploadingOverlay />}
    </div>
  );
}

function UploadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 text-[11px] font-medium text-white">
      업로드 중…
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted/60 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted/60 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted/60" />
    </span>
  );
}

// ── 아이콘 — 외부 라이브러리 없이 인라인 SVG ──────────
function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14m7-7-7 7-7-7" />
    </svg>
  );
}

function IconArrowUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5m-7 7 7-7 7 7" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
