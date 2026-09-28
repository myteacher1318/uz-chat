"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MEDIA_ACCEPT,
  MEDIA_IMAGE_TYPES,
  MEDIA_MAX_FILE_BYTES,
  extensionFor,
  type JobKind,
} from "@/lib/mediaApi";
import type { JobView, ResultItem } from "./MediaProvider";

// 이미지·영상 화면 공용 부품. 모바일 우선: 입력 글자 16px(iOS 확대 방지),
// 터치 대상 높이 40px 이상, 한 칸 레이아웃.

export const inputClass =
  "w-full rounded-xl border border-line bg-raised px-3.5 py-2.5 text-base shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-colors placeholder:text-muted/70 focus:border-accent/50 md:text-sm";

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-raised/60 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:p-5">
      {children}
    </section>
  );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
      <span className="text-sm font-medium">{children}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** 버튼형 단일 선택 (라디오 그룹). 좁은 화면에선 줄바꿈된다. */
export function Choice<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string; sub?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={[
                "flex min-h-10 min-w-[3.25rem] flex-col items-center justify-center rounded-xl border px-3 py-1.5 text-sm transition-colors",
                on
                  ? "border-accent bg-accent-soft font-medium text-accent"
                  : "border-line bg-raised text-foreground/80 hover:border-accent/40",
              ].join(" ")}
            >
              <span className="leading-tight">{o.label}</span>
              {o.sub && <span className="text-[11px] leading-tight text-muted">{o.sub}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 켜기/끄기 스위치 (role="switch") */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-10 w-full items-center gap-3 text-left"
    >
      <span
        className={[
          "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-foreground/20",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          ].join(" ")}
        />
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}

export type Picked = { key: string; file: File; url: string };

/**
 * 업로드할 이미지 목록. 미리보기 object URL 은 고를 때 만들고, 빼거나 비우거나
 * 화면을 떠날 때 해제한다 (작업 내용 지우기가 '모든 object URL 해제'를 요구).
 */
export function usePickedImages(max: number) {
  const [items, setItems] = useState<Picked[]>([]);
  const itemsRef = useRef<Picked[]>([]);
  const seq = useRef(0);

  const commit = useCallback((next: Picked[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  // 반환값: problem = 거른 파일이 있으면 그 이유(없으면 null), added = 실제로 추가된 항목
  const add = useCallback(
    (files: FileList | File[]): { problem: string | null; added: Picked[] } => {
      const next = [...itemsRef.current];
      const added: Picked[] = [];
      let problem: string | null = null;
      for (const file of Array.from(files)) {
        if (!MEDIA_IMAGE_TYPES.includes(file.type)) {
          problem = "JPG·PNG·WEBP 이미지만 올릴 수 있습니다.";
          continue;
        }
        if (file.size > MEDIA_MAX_FILE_BYTES) {
          problem = "한 장당 25MB 이하만 올릴 수 있습니다.";
          continue;
        }
        if (next.length >= max) {
          problem = `최대 ${max}장까지 올릴 수 있습니다.`;
          break;
        }
        const item = { key: `p${seq.current++}`, file, url: URL.createObjectURL(file) };
        next.push(item);
        added.push(item);
      }
      commit(next);
      return { problem, added };
    },
    [commit, max],
  );

  const remove = useCallback(
    (key: string) => {
      const gone = itemsRef.current.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      commit(itemsRef.current.filter((p) => p.key !== key));
    },
    [commit],
  );

  const reset = useCallback(() => {
    for (const p of itemsRef.current) URL.revokeObjectURL(p.url);
    commit([]);
  }, [commit]);

  useEffect(() => {
    return () => {
      for (const p of itemsRef.current) URL.revokeObjectURL(p.url);
    };
  }, []);

  return { items, add, remove, reset };
}

/** 이미지 고르기 버튼 + 미리보기 썸네일 */
export function ImagePicker({
  label,
  hint,
  multiple,
  max,
  picked,
  inputRef,
  onAdd,
  onRemove,
}: {
  label: string;
  hint: string;
  multiple: boolean;
  max: number;
  picked: Picked[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAdd: (files: FileList) => void;
  onRemove: (key: string) => void;
}) {
  const full = picked.length >= max;
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {picked.map((p, i) => (
          <div
            key={p.key}
            className="relative h-20 w-20 overflow-hidden rounded-xl border border-line bg-surface"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`첨부 ${i + 1}`} className="h-full w-full object-cover" />
            {multiple && (
              <span className="absolute left-1 top-1 rounded-md bg-black/55 px-1.5 text-[11px] font-medium text-white">
                {i + 1}
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(p.key)}
              aria-label={`첨부 ${i + 1} 빼기`}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <IconX />
            </button>
          </div>
        ))}
        {!full && (
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-raised text-muted transition-colors hover:border-accent/50 hover:text-accent">
            <IconImage />
            <span className="text-[11px]">{picked.length === 0 ? "선택" : "추가"}</span>
            <input
              ref={inputRef}
              type="file"
              accept={MEDIA_ACCEPT}
              multiple={multiple}
              className="sr-only"
              onChange={(e) => {
                if (e.target.files?.length) onAdd(e.target.files);
                // 같은 파일을 다시 고를 수 있게, 그리고 input 에 파일이 남지 않게 비운다.
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<JobView["status"], string> = {
  queued: "대기 중",
  running: "생성 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

function downloadName(kind: JobKind, r: ResultItem): string {
  return `uz-${kind}-${r.index + 1}.${extensionFor(r.mime)}`;
}

/**
 * 결과 이미지 전체 화면 보기. 바깥·닫기·Esc 로 닫는다. 열려 있는 동안 뒤 페이지
 * 스크롤을 막고, 같은 Blob 으로 바로 저장할 수 있게 저장 버튼을 둔다.
 */
function Lightbox({
  src,
  alt,
  downloadName,
  onClose,
}: {
  src: string;
  alt: string;
  downloadName: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 font-sans"
    >
      <div className="flex justify-end px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <IconX />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <a
          href={src}
          download={downloadName}
          onClick={(e) => e.stopPropagation()}
          className="flex min-h-10 items-center gap-1.5 rounded-full bg-white px-5 text-sm font-medium text-black"
        >
          <IconDownload />
          저장
        </a>
      </div>
    </div>
  );
}

function formatSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** 현재 작업의 상태·결과·지우기 버튼 */
export function JobPanel({
  kind,
  job,
  clearing,
  clearError,
  onClear,
  onEditResult,
  details,
}: {
  kind: JobKind;
  job: JobView;
  clearing: boolean;
  clearError: string | null;
  onClear: () => void;
  // 이미지 결과를 원본으로 삼아 이어서 편집 (이미지 화면만 넘긴다)
  onEditResult?: (r: ResultItem) => void;
  // 상태 아래에 덧붙일 내용 (이미지 화면의 '보낸 편집 정보')
  details?: React.ReactNode;
}) {
  const [zoomed, setZoomed] = useState<ResultItem | null>(null);
  const closeZoom = useCallback(() => setZoomed(null), []);
  const busy = job.status === "queued" || job.status === "running" || job.pending;
  const tone =
    job.status === "done"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : job.status === "failed" || job.status === "cancelled"
        ? "bg-red-500/10 text-red-500"
        : "bg-accent-soft text-accent";
  const noun = kind === "image" ? "이미지" : "영상";

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">현재 작업</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
          {busy && <IconSpinner />}
          {job.pending ? "결과 받는 중" : STATUS_LABEL[job.status]}
        </span>
      </div>

      {busy && (
        <p className="mt-2 text-xs text-muted">
          {kind === "video"
            ? "영상은 몇 분 걸릴 수 있습니다. 이 화면을 떠나도 서버 작업은 계속되지만, 결과는 이 화면에서만 받을 수 있습니다."
            : "2~3초마다 상태를 확인합니다."}
        </p>
      )}
      {job.note && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {job.note}
        </p>
      )}
      {details}

      {job.results.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {job.results.map((r) => (
            <li key={r.index} className="flex flex-col gap-2">
              {kind === "image" ? (
                <button
                  type="button"
                  onClick={() => setZoomed(r)}
                  aria-label={`생성된 이미지 ${r.index + 1} 크게 보기`}
                  className="group relative cursor-zoom-in overflow-hidden rounded-xl border border-line bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.objectUrl}
                    alt={`생성된 이미지 ${r.index + 1}`}
                    className="w-full object-contain"
                  />
                  <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
                    <IconExpand />
                  </span>
                </button>
              ) : (
                <video
                  src={r.objectUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full rounded-xl bg-black"
                />
              )}
              <div className={onEditResult ? "grid grid-cols-2 gap-2" : "flex"}>
                <a
                  href={r.objectUrl}
                  download={downloadName(kind, r)}
                  className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-raised px-3 text-sm font-medium transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <IconDownload />
                  {onEditResult ? "저장" : `${noun} ${r.index + 1} 저장`} ({formatSize(r.size)})
                </a>
                {onEditResult && (
                  <button
                    type="button"
                    onClick={() => onEditResult(r)}
                    disabled={clearing}
                    className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 text-sm font-medium text-accent transition-colors hover:border-accent disabled:opacity-50"
                  >
                    <IconEdit />이 이미지로 편집
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {zoomed && (
        <Lightbox
          src={zoomed.objectUrl}
          alt={`생성된 이미지 ${zoomed.index + 1}`}
          downloadName={downloadName(kind, zoomed)}
          onClose={closeZoom}
        />
      )}

      <div className="mt-4 border-t border-line pt-4">
        <button
          type="button"
          onClick={onClear}
          disabled={clearing}
          className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/40 px-4 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/[.06] disabled:opacity-50"
        >
          {clearing ? <IconSpinner /> : <IconTrash />}
          작업 내용 지우기
        </button>
        {clearError && (
          <p role="alert" className="mt-2 text-sm text-red-500">
            {clearError}
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          서버의 프롬프트·업로드·결과를 즉시 폐기하고 이 화면에서도 지웁니다. 지우지 않아도
          서버는 결과를 받는 즉시, 받지 않은 결과는 15분 뒤 삭제합니다.
        </p>
      </div>
    </Card>
  );
}

/** 제출 버튼 */
export function SubmitButton({
  children,
  disabled,
  busy,
}: {
  children: React.ReactNode;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-colors hover:bg-accent-strong disabled:opacity-40"
    >
      {busy && <IconSpinner />}
      {children}
    </button>
  );
}

function IconX() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-8 9" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
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

export function IconSpinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
