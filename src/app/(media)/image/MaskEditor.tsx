"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

// 부분 편집(마스크) 그리기 화면.
//
// 칠한 획은 원본 픽셀 좌표의 점 목록으로만 들고 있다. 화면에는 반투명 오버레이 캔버스로
// 보여 주고, 전송할 때에만 원본과 같은 크기의 마스크 캔버스(검정 바탕, 브러시 흰색,
// 지우개 검정)에 다시 그려 PNG 로 내보낸다. 실행 취소를 캔버스 스냅샷이 아닌 획 목록으로
// 두는 이유: 1,200만 화소 사진이면 스냅샷 한 장이 약 48MB 라 휴대폰에서 몇 번만 되돌려도
// 메모리가 바닥난다.
//
// 획·캔버스·내보낸 Blob 은 이 컴포넌트의 메모리에만 있다. 원본을 바꾸거나 빼거나,
// 부분 편집을 끄거나, 작업 내용을 지우면 부모가 이 컴포넌트를 내려 모두 사라진다.

type Point = { x: number; y: number };
type Stroke = { erase: boolean; size: number; points: Point[] }; // size·좌표 모두 원본 픽셀 단위

export type MaskEditorHandle = {
  /** 칠한 곳이 없으면 null. 원본이 너무 커서 만들 수 없으면 throw. */
  exportMask: () => Promise<Blob | null>;
};

// iOS Safari 의 캔버스 면적 상한. 넘으면 캔버스가 조용히 비어 버린다.
const MAX_MASK_PIXELS = 4096 * 4096;
const OVERLAY_COLOR = "#ff3b6b";
const MIN_BRUSH = 8;
const MAX_BRUSH = 120;

function traceStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number, from: number) {
  const pts = s.points;
  const width = Math.max(1, s.size * scale);
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x * scale, pts[0].y * scale, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const start = Math.max(0, from - 1);
  ctx.moveTo(pts[start].x * scale, pts[start].y * scale);
  for (let i = start + 1; i < pts.length; i++) ctx.lineTo(pts[i].x * scale, pts[i].y * scale);
  ctx.stroke();
}

// 화면 오버레이: 칠한 곳은 강조색, 지우개는 그 색을 걷어낸다 (캔버스 자체 opacity 로 반투명)
function drawOverlayStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number, from = 0) {
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = OVERLAY_COLOR;
  ctx.fillStyle = OVERLAY_COLOR;
  traceStroke(ctx, s, scale, from);
  ctx.globalCompositeOperation = "source-over";
}

// 전송 마스크: 불투명 검정 바탕에 브러시는 흰색, 지우개는 검정
function paintMask(canvas: HTMLCanvasElement, strokes: Stroke[], scale: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("mask export failed");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    ctx.strokeStyle = s.erase ? "#000" : "#fff";
    ctx.fillStyle = ctx.strokeStyle;
    traceStroke(ctx, s, scale, 0);
  }
  return ctx;
}

export default function MaskEditor({
  src,
  onPaintedChange,
  ref,
}: {
  src: string;
  onPaintedChange?: (painted: boolean) => void;
  ref?: React.Ref<MaskEditorHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<{ pointerId: number; stroke: Stroke } | null>(null);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [brush, setBrush] = useState(40); // 화면 px
  const [strokeCount, setStrokeCount] = useState(0);
  const tooLarge = !!natural && natural.w * natural.h > MAX_MASK_PIXELS;

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const nat = naturalRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !nat || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const scale = c.width / nat.w;
    for (const s of strokesRef.current) drawOverlayStroke(ctx, s, scale);
    if (currentRef.current) drawOverlayStroke(ctx, currentRef.current.stroke, scale);
  }, []);

  // 오버레이 캔버스의 내부 해상도를 화면 크기(× 기기 픽셀 비율)에 맞춘다.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !natural) return;
    const fit = () => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.max(1, Math.round(rect.width * dpr));
      c.height = Math.max(1, Math.round(rect.height * dpr));
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [natural, redraw]);

  const syncCount = useCallback(() => {
    setStrokeCount(strokesRef.current.length);
    onPaintedChange?.(strokesRef.current.some((s) => !s.erase));
  }, [onPaintedChange]);

  // 화면 좌표 → 원본 픽셀 좌표. 화면(CSS) 크기와 원본 크기가 달라 비율로 환산한다.
  function toNatural(clientX: number, clientY: number): Point {
    const c = canvasRef.current!;
    const nat = naturalRef.current!;
    const rect = c.getBoundingClientRect();
    const x = ((clientX - rect.left) * nat.w) / rect.width;
    const y = ((clientY - rect.top) * nat.h) / rect.height;
    return { x: Math.min(Math.max(x, 0), nat.w), y: Math.min(Math.max(y, 0), nat.h) };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const nat = naturalRef.current;
    if (!nat || tooLarge || currentRef.current) return; // 한 번에 손가락 하나만
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    // 손가락이 영역 밖으로 조금 나가도 선이 끊기지 않게 포인터를 붙잡는다.
    // (이미 떨어진 포인터 등으로 실패해도 그리기 자체는 계속한다)
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const stroke: Stroke = {
      erase: tool === "eraser",
      size: (brush * nat.w) / rect.width,
      points: [toNatural(e.clientX, e.clientY)],
    };
    currentRef.current = { pointerId: e.pointerId, stroke };
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) drawOverlayStroke(ctx, stroke, e.currentTarget.width / nat.w);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const cur = currentRef.current;
    const nat = naturalRef.current;
    if (!cur || cur.pointerId !== e.pointerId || !nat) return;
    const pts = cur.stroke.points;
    const before = pts.length;
    // 빠르게 그을 때 사이 좌표까지 받아 선이 각지지 않게 한다
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p = toNatural(ev.clientX, ev.clientY);
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= cur.stroke.size / 8) pts.push(p);
    }
    if (pts.length === before) return;
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) drawOverlayStroke(ctx, cur.stroke, e.currentTarget.width / nat.w, before);
  }

  function onPointerEnd(e: React.PointerEvent<HTMLCanvasElement>) {
    const cur = currentRef.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    currentRef.current = null;
    strokesRef.current = [...strokesRef.current, cur.stroke];
    syncCount();
  }

  function undo() {
    strokesRef.current = strokesRef.current.slice(0, -1);
    redraw();
    syncCount();
  }

  function clearAll() {
    strokesRef.current = [];
    redraw();
    syncCount();
  }

  useImperativeHandle(
    ref,
    () => ({
      async exportMask() {
        const nat = naturalRef.current;
        const strokes = strokesRef.current;
        if (!nat || !strokes.some((s) => !s.erase)) return null;
        if (nat.w * nat.h > MAX_MASK_PIXELS) throw new Error("mask_too_large");

        const canvas = document.createElement("canvas");
        canvas.width = nat.w;
        canvas.height = nat.h;
        try {
          const ctx = paintMask(canvas, strokes, 1);
          // 붓 가장자리의 안티앨리어싱 회색을 없애 순수 검정(0)·흰색(255)만 남긴다.
          // 서버 명세가 '배경은 순수 검정, 칠한 곳은 흰색'이다. 이 과정에서 칠했다가
          // 모두 지워 흰 픽셀이 하나도 없으면 '칠한 곳 없음'으로 본다.
          const img = ctx.getImageData(0, 0, nat.w, nat.h);
          const px = img.data;
          let any = false;
          for (let i = 0; i < px.length; i += 4) {
            const v = px[i] >= 128 ? 255 : 0;
            if (v) any = true;
            px[i] = px[i + 1] = px[i + 2] = v;
            px[i + 3] = 255;
          }
          if (!any) return null;
          ctx.putImageData(img, 0, 0);
          return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error("mask export failed"))),
              "image/png",
            );
          });
        } finally {
          canvas.width = canvas.height = 0; // 큰 캔버스 메모리를 바로 놓는다
        }
      },
    }),
    [],
  );

  const toolBtn = (on: boolean) =>
    [
      "flex min-h-10 items-center justify-center rounded-xl border px-3 text-sm transition-colors",
      on
        ? "border-accent bg-accent-soft font-medium text-accent"
        : "border-line bg-raised text-foreground/80 hover:border-accent/40",
    ].join(" ");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-center rounded-xl border border-line bg-surface p-1 sm:p-2">
        <div className="relative inline-block select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="부분 편집할 원본"
            draggable={false}
            onLoad={(e) => {
              const size = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
              naturalRef.current = size;
              setNatural(size);
            }}
            className="block max-h-[60vh] w-auto max-w-full"
          />
          <canvas
            ref={canvasRef}
            aria-label="칠할 영역 그리기"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onContextMenu={(e) => e.preventDefault()}
            className={`absolute inset-0 h-full w-full opacity-50 ${tooLarge ? "" : "cursor-crosshair"}`}
            style={{ touchAction: "none" }}
          />
        </div>
      </div>

      {tooLarge ? (
        <p role="alert" className="text-sm text-red-500">
          원본이 너무 커서(최대 약 1,670만 화소) 부분 편집을 할 수 없습니다. 크기를 줄인 원본을
          사용하거나 부분 편집을 끄고 전체 편집을 해 주세요.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="그리기 도구" className="flex gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={tool === "brush"}
                onClick={() => setTool("brush")}
                className={toolBtn(tool === "brush")}
              >
                브러시
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={tool === "eraser"}
                onClick={() => setTool("eraser")}
                className={toolBtn(tool === "eraser")}
              >
                지우개
              </button>
            </div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={undo}
                disabled={strokeCount === 0}
                className={`${toolBtn(false)} disabled:opacity-40`}
              >
                실행 취소
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={strokeCount === 0}
                className={`${toolBtn(false)} disabled:opacity-40`}
              >
                전체 지우기
              </button>
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm">
            <span className="shrink-0 text-muted">크기</span>
            <input
              type="range"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              step={4}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
              aria-label="브러시 크기"
              className="h-8 min-w-0 flex-1 accent-accent"
            />
            <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
              <span
                className="rounded-full bg-[#ff3b6b]/60"
                style={{ width: Math.min(brush, 40), height: Math.min(brush, 40) }}
              />
            </span>
          </label>

          <p className="text-xs text-muted">
            칠한 영역만 변경됩니다.
            {strokeCount === 0 && " 칠한 곳이 없으면 이미지 전체를 편집합니다."}
          </p>
        </>
      )}
    </div>
  );
}
