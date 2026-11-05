"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  INLINE_MAX_BYTES,
  formatBytes,
  isAllowedType,
  maxBytesFor,
} from "@/lib/attachments";
import { fileToBase64, readApiError, type UIAttachment } from "./types";

/**
 * 입력창에 붙인 첨부 목록. 파일 선택·드래그앤드롭·클립보드 붙여넣기가 모두
 * addFiles 하나를 타므로 형식·크기 검사와 인라인/Blob 분기가 그대로 적용된다.
 */
export function useAttachments() {
  const [pending, setPending] = useState<UIAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  // 붙여넣은 이미지의 순번 — 이름 없는 클립보드 비트맵을 구분하기 위한 것
  const pasteCounter = useRef(0);

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
            throw new Error(await readApiError(res, "업로드에 실패했습니다."));
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

  /**
   * 목록 비우기. 전송 직후에는 첨부가 메시지로 옮겨가 미리보기 URL 을 계속 쓰므로
   * revoke 하지 않고, 대화를 바꾸거나 새로 시작할 때는 해제한다.
   */
  function clearPending(revoke: boolean) {
    setPending((prev) => {
      if (revoke) {
        for (const p of prev) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
      return [];
    });
    setAttachError(null);
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
  // 스크린샷(Win+Shift+S 등)을 저장 없이 바로 올릴 수 있는 게 주 용도다.
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

  const uploading = pending.some((p) => p.uploading);

  return {
    pending,
    uploading,
    attachError,
    dragActive,
    fileInputRef,
    addFiles,
    removeAttachment,
    clearPending,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
    onPaste,
  };
}
