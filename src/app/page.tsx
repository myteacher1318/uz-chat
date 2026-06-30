"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  ACCEPT,
  INLINE_MAX_BYTES,
  MAX_FILE_BYTES,
  isAllowedType,
} from "@/lib/attachments";

// 모델 선택지 — 라벨은 사람이 읽기 쉽게, 값은 실제 모델 ID.
const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (균형)" },
  { id: "claude-opus-4-8", label: "Opus 4.8 (고품질)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (빠름/저렴)" },
] as const;

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
  role: "user" | "assistant";
  content: string;
  attachments?: UIAttachment[];
  error?: boolean;
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

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [pending, setPending] = useState<UIAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // 첫 로드: 대화 목록을 불러와 가장 최근 대화를 자동 선택
  useEffect(() => {
    (async () => {
      const list = await refreshConversations();
      if (list.length > 0) {
        setActiveConversationId(list[0].id);
        void loadMessages(list[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // ── 대화 목록/메시지 ──────────────────────────
  async function refreshConversations(): Promise<Conversation[]> {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return [];
      const list = (await res.json()) as Conversation[];
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }

  async function loadMessages(conversationId: string) {
    try {
      const res = await fetch(
        `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
      );
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const rows = (await res.json()) as {
        role: "user" | "assistant";
        content: string;
        attachments: { name: string; type: string }[] | null;
      }[];
      setMessages(
        rows.map((r) => ({
          role: r.role,
          content: r.content,
          attachments: Array.isArray(r.attachments)
            ? r.attachments.map((a) => ({
                id: crypto.randomUUID(),
                name: a.name,
                mediaType: a.type,
                size: 0,
              }))
            : undefined,
        })),
      );
    } catch {
      setMessages([]);
    }
  }

  function newConversation() {
    setActiveConversationId(null);
    setMessages([]);
    setPending([]);
    setInput("");
    setAttachError(null);
    setSidebarOpen(false);
  }

  function selectConversation(id: string) {
    setSidebarOpen(false);
    if (id === activeConversationId) return;
    setActiveConversationId(id);
    setPending([]);
    setInput("");
    setAttachError(null);
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

    for (const file of files) {
      if (!isAllowedType(file.type)) {
        setAttachError(`지원하지 않는 형식입니다: ${file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setAttachError(`32MB를 초과했습니다: ${file.name}`);
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
          setAttachError(null);
        } catch {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setAttachError(`파일을 읽지 못했습니다: ${file.name}`);
        }
      } else {
        setPending((prev) => [
          ...prev,
          { id, name: file.name, mediaType: file.type, size: file.size, previewUrl, uploading: true },
        ]);
        setAttachError(null);
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

  // ── 전송 ──────────────────────────────────────
  async function send() {
    const text = input.trim();
    const uploading = pending.some((p) => p.uploading);
    if ((text === "" && pending.length === 0) || loading || uploading) return;

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
      role: "user",
      content: text,
      attachments: pending.length ? pending : undefined,
    };
    const nextMessages: Message[] = [...messages, userMsg];

    setMessages(nextMessages);
    setInput("");
    setPending([]);
    setAttachError(null);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          conversationId: convId,
          messages: nextMessages.map((m) => ({
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
        setMessages((prev) => {
          const copy = [...prev];
          const lastIdx = copy.length - 1;
          copy[lastIdx] = {
            ...copy[lastIdx],
            content: copy[lastIdx].content + chunk,
          };
          return copy;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "오류가 발생했습니다.";
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `⚠️ ${msg}`,
          error: true,
        };
        return copy;
      });
    } finally {
      setLoading(false);
      void refreshConversations(); // 새 대화/제목/순서 반영
    }
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

  const isEmpty = messages.length === 0;
  const uploading = pending.some((p) => p.uploading);
  const canSend =
    !loading && !uploading && (input.trim() !== "" || pending.length > 0);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 모바일 백드롭 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 사이드바 */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-20 flex w-64 transform flex-col border-r border-black/[.08] bg-background transition-transform md:static md:z-auto md:translate-x-0 dark:border-white/[.12]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={newConversation}
            className="w-full rounded-lg border border-black/[.1] px-3 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
          >
            + 새 대화
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-zinc-400">
              대화가 없습니다
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((c) => {
                const active = c.id === activeConversationId;
                return (
                  <li
                    key={c.id}
                    className={[
                      "group flex items-center rounded-lg",
                      active
                        ? "bg-black/[.06] dark:bg-white/[.1]"
                        : "hover:bg-black/[.03] dark:hover:bg-white/[.05]",
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
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(c)}
                      aria-label="대화 삭제"
                      title="삭제"
                      className="mr-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-black/[.06] hover:text-red-500 group-hover:flex dark:hover:bg-white/[.1]"
                    >
                      🗑
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      {/* 채팅 영역 */}
      <div
        className="relative flex flex-1 flex-col font-sans"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 헤더 */}
        <header className="flex items-center gap-2 border-b border-black/[.08] px-4 py-3 dark:border-white/[.12]">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="대화 목록"
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-black/[.06] md:hidden dark:hover:bg-white/[.1]"
          >
            ☰
          </button>
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
            UZ
          </span>
          <h1 className="text-base font-semibold tracking-tight">UZ Chat</h1>
        </header>

        {/* 메시지 영역 */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
            {isEmpty && (
              <div className="mt-24 text-center text-zinc-500 dark:text-zinc-400">
                <p className="text-lg font-medium">무엇이든 물어보세요</p>
                <p className="mt-1 text-sm">
                  Claude 기반 한국어 어시스턴트입니다. 이미지·PDF를 끌어다 놓아 보세요.
                </p>
              </div>
            )}

            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}

            {loading &&
              messages.length > 0 &&
              messages[messages.length - 1].role === "assistant" &&
              messages[messages.length - 1].content === "" && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-black/[.04] px-4 py-3 dark:bg-white/[.06]">
                    <TypingDots />
                  </div>
                </div>
              )}

            <div ref={bottomRef} />
          </div>
        </main>

        {/* 입력 영역 */}
        <footer className="border-t border-black/[.08] px-4 py-3 dark:border-white/[.12]">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                모델
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="rounded-md border border-black/[.1] bg-transparent px-2 py-1 text-xs text-foreground outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id} className="text-black">
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              {attachError && (
                <span className="truncate text-xs text-red-500">{attachError}</span>
              )}
            </div>

            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pending.map((a) => (
                  <div key={a.id} className="relative">
                    <AttachmentPreview att={a} />
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      aria-label="첨부 제거"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white shadow hover:bg-zinc-700 dark:bg-zinc-200 dark:text-black"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                aria-label="파일 첨부"
                title="파일 첨부 (이미지·PDF)"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/[.1] text-lg transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:hover:bg-white/[.06]"
              >
                📎
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
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={loading}
                rows={1}
                placeholder="메시지를 입력하세요  (Enter 전송 · Shift+Enter 줄바꿈)"
                className="max-h-[200px] flex-1 resize-none rounded-2xl border border-black/[.1] bg-transparent px-4 py-3 text-[15px] leading-6 outline-none placeholder:text-zinc-400 focus:border-black/30 disabled:opacity-60 dark:border-white/[.15] dark:focus:border-white/40"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                className="h-11 shrink-0 rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {uploading ? "업로드 중" : "전송"}
              </button>
            </div>
          </div>
        </footer>

        {/* 드롭 오버레이 */}
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-foreground/5 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-foreground/40 bg-background px-8 py-6 text-center">
              <p className="text-lg font-medium">여기에 파일을 놓으세요</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
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
            className="w-full max-w-sm rounded-2xl border border-black/[.08] bg-background p-5 shadow-xl dark:border-white/[.12]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">대화를 삭제할까요?</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              <b className="break-words text-foreground">{deleteTarget.title}</b>
              <br />이 대화의 모든 메시지가 영구 삭제되며 되돌릴 수 없습니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-lg border border-black/[.1] px-4 py-2 text-sm transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:hover:bg-white/[.06]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-7",
          isUser
            ? "bg-foreground text-background"
            : message.error
              ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : "bg-black/[.04] text-foreground dark:bg-white/[.06]",
        ].join(" ")}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <AttachmentPreview key={a.id} att={a} />
            ))}
          </div>
        )}
        {message.content && (
          <div className="whitespace-pre-wrap">{message.content}</div>
        )}
      </div>
    </div>
  );
}

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
          className="h-20 w-20 rounded-lg border border-black/[.06] object-cover dark:border-white/[.1]"
        />
        {att.uploading && <UploadingOverlay />}
      </div>
    );
  }

  // 그 외(복원된 첨부 포함): 파일 칩
  return (
    <div className="relative flex h-20 w-32 flex-col justify-center gap-1 rounded-lg border border-black/[.1] bg-background px-3 dark:border-white/[.15]">
      <span className="text-xl">{isPdf ? "📄" : "📎"}</span>
      <span className="truncate text-xs text-zinc-600 dark:text-zinc-300">
        {att.name}
      </span>
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
      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
    </span>
  );
}
