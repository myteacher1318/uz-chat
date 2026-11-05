"use client";

import { useEffect, useRef, useState } from "react";
import { MODELS, DEFAULT_THINKING_DEPTH, type ThinkingDepth } from "@/lib/ai/models";
import type { TurnMode } from "@/lib/ai/types";
import HeaderBrand from "./HeaderBrand";
import SectionNav from "./SectionNav";
import { Composer } from "./chat/Composer";
import { IconArrowDown, IconMenu } from "./chat/icons";
import { MessageBubble, TypingDots } from "./chat/MessageBubble";
import { Sidebar } from "./chat/Sidebar";
import { readApiError, type Conversation, type Message } from "./chat/types";
import { useAttachments } from "./chat/useAttachments";
import { useChatStream } from "./chat/useChatStream";
import { useConversationList } from "./chat/useConversationList";
import { useMessageHistory } from "./chat/useMessageHistory";
import { useStickToBottom } from "./chat/useStickToBottom";

// 채팅 화면 본체. 상태는 역할별 훅(목록·메시지·첨부·스트림·스크롤)이 들고,
// 여기서는 전송·재생성·수정·삭제처럼 여러 훅을 엮는 흐름만 다룬다.
export default function ChatClient() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(MODELS[0].id);
  // 웹 검색은 기본 켬 — 토글 버튼으로 끌 수 있다 (Claude·GPT 모두 지원)
  const [webSearch, setWebSearch] = useState(true);
  const [depth, setDepth] = useState<ThinkingDepth>(DEFAULT_THINKING_DEPTH);
  const [editPending, setEditPending] = useState(false); // 다음 전송이 '마지막 턴 수정'인지
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 이중 전송 방지 — loading은 React 상태라 streamTurn 안에서 비동기로 켜진다.
  // 그 사이(대화 생성 await 등) 두 번째 트리거가 stale한 loading=false를 보고
  // 통과하면 질문·답변·DB 저장이 2번씩 일어난다. ref는 동기적으로 즉시 읽혀
  // 이 경쟁을 막는다. (Enter 연타·더블클릭·한글 IME 중복 keydown 대비)
  const sendingRef = useRef(false);

  const list = useConversationList();
  const { mainRef, stickRef, atBottom, follow, onScroll, onUserScrollIntent, scrollToBottom } =
    useStickToBottom();
  const history = useMessageHistory(stickRef, mainRef);
  const { messages, setMessages } = history;
  const {
    pending,
    uploading,
    attachError,
    dragActive,
    fileInputRef,
    addFiles,
    removeAttachment,
    clearPending,
    dragHandlers,
    onPaste,
  } = useAttachments();
  const stream = useChatStream(setMessages, stickRef, () => {
    void list.refresh(); // 새 대화/제목/순서 반영
    // 첫 문답의 제목은 응답 종료 후 서버가 비동기로 생성 — 잠시 뒤 한 번 더 반영
    setTimeout(() => void list.refresh(), 3000);
  });
  const { loading } = stream;

  // 자동 스크롤 — 메시지가 바뀔 때마다, 사용자가 바닥 근처에 있을 때만.
  useEffect(() => {
    follow();
  }, [messages, follow]);

  // 첫 로드: 대화 목록을 불러와 가장 최근 대화를 자동 선택
  useEffect(() => {
    (async () => {
      const first = await list.refresh();
      if (first.length > 0) {
        setActiveConversationId(first[0].id);
        void history.load(first[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 대화 전환 ─────────────────────────────────
  function newConversation() {
    history.reset();
    setActiveConversationId(null);
    clearPending(true);
    setInput("");
    setEditPending(false);
    setSidebarOpen(false);
  }

  function selectConversation(id: string) {
    setSidebarOpen(false);
    if (id === activeConversationId) return;
    setActiveConversationId(id);
    clearPending(true);
    setInput("");
    setEditPending(false);
    void history.load(id);
  }

  // 휴지통 버튼은 즉시 삭제하지 않고 확인 모달을 띄운다 (실수 방지)
  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleting(true);
    setDeleteError(null);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {
        setDeleteError("삭제 요청을 보내지 못했습니다. 네트워크를 확인해 주세요.");
        return;
      }
      if (!res.ok) {
        setDeleteError(await readApiError(res, "삭제하지 못했습니다. 다시 시도해 주세요."));
        return;
      }
      setDeleteTarget(null);
      const remaining = await list.refresh();
      if (id === activeConversationId) {
        if (remaining.length > 0) {
          setActiveConversationId(remaining[0].id);
          void history.load(remaining[0].id);
        } else {
          history.reset();
          setActiveConversationId(null);
        }
      }
    } finally {
      setDeleting(false);
    }
  }

  // ── 전송 ──────────────────────────────────────
  const canSend =
    !loading &&
    !uploading &&
    !history.loadingMessages &&
    (input.trim() !== "" || pending.length > 0);

  async function send() {
    if (sendingRef.current) return; // 이미 전송 처리 중 — 이중 전송 차단(동기)
    const text = input.trim();
    if ((text === "" && pending.length === 0) || !canSend) return;
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
            void list.refresh();
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
        createdAt: new Date().toISOString(),
      };
      const nextMessages: Message[] = [...messages, userMsg];

      setMessages(nextMessages);
      setInput("");
      clearPending(false); // 첨부는 메시지로 옮겨갔으니 미리보기 URL 은 유지

      const mode: TurnMode = editPending ? "edit" : "normal";
      setEditPending(false);
      await stream.streamTurn(convId, nextMessages, mode, { model, webSearch, depth });
    } finally {
      sendingRef.current = false;
    }
  }

  // 마지막 assistant 응답을 버리고 같은 질문으로 다시 생성
  async function regenerate() {
    if (sendingRef.current || loading) return; // 이중 실행 차단(동기)
    const past = [...messages];
    while (past.length && past[past.length - 1].role === "assistant") {
      past.pop();
    }
    if (past.length === 0 || past[past.length - 1].role !== "user") {
      return;
    }
    sendingRef.current = true;
    try {
      setMessages(past);
      await stream.streamTurn(activeConversationId, past, "regenerate", {
        model,
        webSearch,
        depth,
      });
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const isEmpty = messages.length === 0;
  const currentModel = MODELS.find((m) => m.id === model);
  const isAnthropic = currentModel?.provider === "anthropic";
  // 사고 깊이는 adaptive thinking 지원 모델(Claude 계열)에서만 의미가 있다.
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
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={list.conversations}
        activeId={activeConversationId}
        listError={list.listError}
        search={list.search}
        onSearchChange={list.setSearch}
        onNew={newConversation}
        onSelect={selectConversation}
        onDeleteRequest={(c) => {
          setDeleteError(null);
          setDeleteTarget(c);
        }}
      />

      {/* 채팅 영역 */}
      {/*
        min-w-0 은 필수. flex 아이템의 기본값 min-width:auto 는 내용의 최소 너비보다
        작게 줄어들지 못하게 하는데, 긴 코드 한 줄이나 넓은 수식이 들어오면 이 칼럼이
        화면보다 넓게 벌어진다. 상위 컨테이너가 overflow-hidden 이라 넘친 부분은
        스크롤로도 볼 수 없고, 좌측 패딩까지 화면 밖으로 밀려 본문이 잘린다.
      */}
      <div className="relative flex min-w-0 flex-1 flex-col font-sans" {...dragHandlers}>
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
          <HeaderBrand />
          <SectionNav current="chat" />
        </header>

        {/* 메시지 영역 */}
        <main
          ref={mainRef}
          onScroll={onScroll}
          onWheel={onUserScrollIntent}
          onTouchMove={onUserScrollIntent}
          className="nice-scroll flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
            {isEmpty && !history.loadingMessages && (
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

            {history.hasMoreOlder && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void history.loadOlder(activeConversationId)}
                  disabled={history.loadingOlder}
                  className="rounded-full border border-line bg-raised px-4 py-1.5 text-xs text-muted transition-colors hover:text-accent disabled:opacity-50"
                >
                  {history.loadingOlder ? "불러오는 중…" : "↑ 이전 대화 더 보기"}
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
              messages[messages.length - 1].content === "" &&
              !messages[messages.length - 1].thinking && (
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

        <Composer
          input={input}
          onInputChange={setInput}
          textareaRef={textareaRef}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          pending={pending}
          uploading={uploading}
          attachError={attachError}
          gptFileWarning={gptFileWarning}
          fileInputRef={fileInputRef}
          onAddFiles={(files) => void addFiles(files)}
          onRemoveAttachment={removeAttachment}
          model={model}
          onModelChange={setModel}
          depth={depth}
          onDepthChange={setDepth}
          supportsDepth={supportsDepth}
          webSearch={webSearch}
          onToggleWebSearch={() => setWebSearch((v) => !v)}
          loading={loading}
          loadingMessages={history.loadingMessages}
          canSend={canSend}
          onSend={() => void send()}
          onStop={stream.stopGenerating}
        />

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
            {deleteError && (
              <p role="alert" className="mt-3 text-sm text-red-500">
                {deleteError}
              </p>
            )}
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
                {deleting ? "삭제 중…" : deleteError ? "다시 시도" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
