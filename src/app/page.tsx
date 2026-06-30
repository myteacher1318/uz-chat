"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    // 스트리밍으로 채워질 빈 assistant 말풍선을 미리 추가
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
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
    // Enter 전송 / Shift+Enter 줄바꿈
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-1 flex-col font-sans">
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
                Claude 기반 한국어 어시스턴트입니다.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {/* 응답 대기 중 표시 (아직 한 글자도 안 온 경우) */}
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
        <div className="mx-auto flex max-w-3xl items-end gap-2">
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
            onClick={() => void send()}
            disabled={loading || input.trim() === ""}
            className="h-11 shrink-0 rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            전송
          </button>
        </div>
      </footer>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-7",
          isUser
            ? "bg-foreground text-background"
            : message.error
              ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : "bg-black/[.04] text-foreground dark:bg-white/[.06]",
        ].join(" ")}
      >
        {message.content}
      </div>
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
