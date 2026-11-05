"use client";

import { memo, useState } from "react";
import Markdown from "../Markdown";
import {
  formatMessageTime,
  isDetachedAttachment,
  type Message,
  type UIAttachment,
} from "./types";

export const MessageBubble = memo(function MessageBubble({
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
  // 답변 시각 — 문답 한 쌍에 하나씩, 답변 아래에만 항상 보인다.
  // (복사·재생성 버튼과 달리 hover 없이도 보여야 언제 나눈 대화인지 알 수 있다)
  const timeLabel =
    !isUser && !message.error && !message.streaming && message.createdAt
      ? formatMessageTime(message.createdAt)
      : null;

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
        {/* 본문 일부가 온 뒤 서버에서 난 오류 — 본문과 섞지 않고 따로 알린다 */}
        {!message.error && message.errorNote && (
          <p
            role="alert"
            className="mt-2 rounded-xl border border-red-500/25 bg-red-500/[.07] px-3 py-2 text-sm text-red-600 dark:text-red-400"
          >
            ⚠️ {message.errorNote}
          </p>
        )}
      </div>
      {(timeLabel || showCopy || onEdit || onRegenerate) && (
        <div className="mt-1.5 flex items-center gap-1">
          {timeLabel && (
            <time
              dateTime={message.createdAt}
              className="px-1.5 text-xs text-muted/70"
            >
              {timeLabel}
            </time>
          )}
          {(showCopy || onEdit || onRegenerate) && (
            <div className="flex gap-1 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
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
      )}
    </div>
  );
});

export function AttachmentPreview({ att }: { att: UIAttachment }) {
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

  // 새로고침으로 복원된 2MB 이하 첨부 — 내용은 DB에 없어 이후 질문에 포함되지 않는다.
  // 그 사실을 칩에 적어 "왜 모델이 파일을 모르지?" 가 되지 않게 한다.
  if (isDetachedAttachment(att)) {
    return (
      <div
        className="flex h-20 w-36 flex-col justify-center gap-0.5 rounded-xl border border-dashed border-line bg-raised/60 px-3"
        title={`${att.name} — 새로고침 전에 보낸 첨부입니다. 내용은 저장되지 않아 이후 질문에는 포함되지 않습니다. 다시 참고하려면 파일을 다시 첨부하세요.`}
      >
        <span className="text-xl opacity-60">{isImage ? "🖼️" : isPdf ? "📄" : "📎"}</span>
        <span className="truncate text-xs text-muted">{att.name}</span>
        <span className="text-[10px] leading-tight text-muted/70">
          이전 첨부 · 이후 질문에 미포함
        </span>
      </div>
    );
  }

  // 그 외(Files API 첨부 포함): 파일 칩
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

export function TypingDots() {
  return (
    <span className="flex gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted/60 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted/60 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted/60" />
    </span>
  );
}
