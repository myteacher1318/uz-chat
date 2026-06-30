"use client";

import { useEffect, useRef, useState } from "react";

// 모델 선택지 — 라벨은 사람이 읽기 쉽게, 값은 실제 모델 ID.
const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (균형)" },
  { id: "claude-opus-4-8", label: "Opus 4.8 (고품질)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (빠름/저렴)" },
] as const;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf";

type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  data: string; // base64 (data: 접두사 제거)
  size: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // 새 메시지 도착 시 맨 아래로 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // textarea 높이 자동 조절
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const accepted: Attachment[] = [];
    let lastError: string | null = null;

    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        lastError = `지원하지 않는 형식입니다: ${file.name}`;
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        lastError = `10MB를 초과했습니다: ${file.name}`;
        continue;
      }
      try {
        const data = await fileToBase64(file);
        accepted.push({
          id: crypto.randomUUID(),
          name: file.name,
          mediaType: file.type,
          data,
          size: file.size,
        });
      } catch {
        lastError = `파일을 읽지 못했습니다: ${file.name}`;
      }
    }

    if (accepted.length) setPending((prev) => [...prev, ...accepted]);
    setAttachError(lastError);
  }

  function removeAttachment(id: string) {
    setPending((prev) => prev.filter((a) => a.id !== id));
  }

  async function send() {
    const text = input.trim();
    if ((text === "" && pending.length === 0) || loading) return;

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

    // 스트리밍으로 채워질 빈 assistant 말풍선을 미리 추가
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments?.map((a) => ({
              name: a.name,
              mediaType: a.mediaType,
              data: a.data,
            })),
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
  const canSend = !loading && (input.trim() !== "" || pending.length > 0);

  return (
    <div
      className="relative flex flex-1 flex-col font-sans"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 헤더 */}
      <header className="border-b border-black/[.08] px-4 py-3 dark:border-white/[.12]">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
            UZ
          </span>
          <h1 className="text-base font-semibold tracking-tight">UZ Chat</h1>
        </div>
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
          {/* 모델 선택 + 첨부 오류 */}
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

          {/* 첨부 미리보기 */}
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

          {/* 입력 줄 */}
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
              전송
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
              이미지(PNG·JPG·WebP·GIF) 또는 PDF · 파일당 최대 10MB
            </p>
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

function AttachmentPreview({ att }: { att: Attachment }) {
  if (att.mediaType.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:${att.mediaType};base64,${att.data}`}
        alt={att.name}
        className="h-20 w-20 rounded-lg border border-black/[.06] object-cover dark:border-white/[.1]"
      />
    );
  }
  return (
    <div className="flex h-20 w-32 flex-col justify-center gap-1 rounded-lg border border-black/[.1] bg-background px-3 dark:border-white/[.15]">
      <span className="text-xl">📄</span>
      <span className="truncate text-xs text-zinc-600 dark:text-zinc-300">
        {att.name}
      </span>
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
