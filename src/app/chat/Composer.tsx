"use client";

import { useEffect, type RefObject } from "react";
import { ACCEPT } from "@/lib/attachments";
import { MODELS, THINKING_DEPTHS, type ThinkingDepth } from "@/lib/ai/models";
import { IconArrowUp, IconGlobe, IconPaperclip, IconSpinner, IconStop } from "./icons";
import { AttachmentPreview } from "./MessageBubble";
import type { UIAttachment } from "./types";

export function Composer({
  input,
  onInputChange,
  textareaRef,
  onKeyDown,
  onPaste,
  pending,
  uploading,
  attachError,
  gptFileWarning,
  fileInputRef,
  onAddFiles,
  onRemoveAttachment,
  model,
  onModelChange,
  depth,
  onDepthChange,
  supportsDepth,
  webSearch,
  onToggleWebSearch,
  loading,
  loadingMessages,
  canSend,
  onSend,
  onStop,
}: {
  input: string;
  onInputChange: (v: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  pending: UIAttachment[];
  uploading: boolean;
  attachError: string | null;
  gptFileWarning: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAddFiles: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  model: string;
  onModelChange: (id: string) => void;
  depth: ThinkingDepth;
  onDepthChange: (d: ThinkingDepth) => void;
  supportsDepth: boolean;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  loading: boolean;
  loadingMessages: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  // 입력 줄 수에 맞춰 높이 조절 (최대 200px)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, textareaRef]);

  return (
    <footer className="px-4 pb-4 pt-1">
      <div className="mx-auto max-w-3xl">
        {(attachError || gptFileWarning) && (
          <p
            className={[
              "mb-1.5 px-2 text-xs",
              attachError ? "text-red-500" : "text-amber-600 dark:text-amber-400",
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
                    onClick={() => onRemoveAttachment(a.id)}
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
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={loading}
            rows={1}
            placeholder={loadingMessages ? "대화를 불러오는 중…" : "무엇이든 물어보세요"}
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
                if (e.target.files) onAddFiles(e.target.files);
                e.target.value = "";
              }}
            />

            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
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
                onChange={(e) => onDepthChange(e.target.value as ThinkingDepth)}
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
              onClick={onToggleWebSearch}
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
                  onClick={onStop}
                  aria-label="응답 중지"
                  title="응답 중지"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-foreground transition-colors hover:bg-foreground/[.05]"
                >
                  <IconStop />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend}
                  aria-label="전송"
                  title={
                    uploading ? "업로드 중…" : loadingMessages ? "대화를 불러오는 중…" : "전송"
                  }
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
  );
}
