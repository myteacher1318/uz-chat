"use client";

import { useEffect, useRef, useState } from "react";
import { bakeOrientation } from "@/lib/imageOrientation";
import { MEDIA_IMAGE_TYPES, MEDIA_MAX_FILE_BYTES, extensionFor } from "@/lib/mediaApi";
import { useMedia, type ResultItem } from "../MediaProvider";
import MaskEditor, { type ExportedMask, type MaskEditorHandle } from "./MaskEditor";
import {
  Card,
  Choice,
  FieldLabel,
  ImagePicker,
  JobPanel,
  SubmitButton,
  Toggle,
  inputClass,
  usePickedImages,
} from "../ui";

type Aspect = "square" | "portrait_3_4" | "landscape_4_3" | "portrait_9_16" | "landscape_16_9";
type Quality = "standard" | "high";
type Style = "none" | "photo" | "illustration" | "anime" | "watercolor" | "render3d";

const ASPECTS: { value: Aspect; label: string; sub: string }[] = [
  { value: "square", label: "1:1", sub: "정사각" },
  { value: "portrait_3_4", label: "3:4", sub: "세로" },
  { value: "landscape_4_3", label: "4:3", sub: "가로" },
  { value: "portrait_9_16", label: "9:16", sub: "세로" },
  { value: "landscape_16_9", label: "16:9", sub: "가로" },
];

// 가로÷세로. 원본 비율과 가장 가까운 값을 고를 때 쓴다.
const ASPECT_RATIO: Record<Aspect, number> = {
  square: 1,
  portrait_3_4: 3 / 4,
  landscape_4_3: 4 / 3,
  portrait_9_16: 9 / 16,
  landscape_16_9: 16 / 9,
};

const QUALITIES: { value: Quality; label: string }[] = [
  { value: "standard", label: "표준" },
  { value: "high", label: "고품질" },
];

const COUNTS = [1, 2, 3, 4].map((n) => ({ value: n, label: `${n}장` }));

// 편집 강도(%) — 서버에는 /100 한 값(0.05~1.0)으로 보낸다. 원본을 해제하면 기본값으로.
const STRENGTH_MIN = 5;
const STRENGTH_MAX = 100;
const STRENGTH_DEFAULT = 65;

// 방금 보낸 편집 요청의 요약 — 결과 칸에 '보낸 편집 정보'로 보여 준다. 실제로 전송된
// 마스크를 눈으로 확인할 수 있게 해서, 결과가 이상할 때 웹과 서버 중 어디 문제인지
// 가릴 수 있다. 메모리에만 두고 작업을 지우면 함께 사라진다.
type SentEdit = {
  strength: number;
  aspect: string; // 화면 표기 (예: "1:1")
  count: number;
  quality: string;
  source: { w: number; h: number } | null;
  sourceType: string;
  mask: ExportedMask | null;
  maskRequested: boolean; // 부분 편집을 켰는지 (켰는데 mask 가 없으면 칠한 곳이 없었던 것)
};
type SentView = Omit<SentEdit, "mask"> & {
  mask: { url: string; width: number; height: number; whiteRatio: number } | null;
};

// 스타일은 서버 옵션이 아니라, 제출할 때 프롬프트 끝에 붙이는 문구다.
// 이미지 모델은 대개 영어 스타일 문구를 가장 잘 따르므로 영어로 둔다.
const STYLES: { value: Style; label: string; phrase: string }[] = [
  { value: "none", label: "없음", phrase: "" },
  { value: "photo", label: "사진", phrase: "photorealistic photo, natural lighting, sharp focus, high detail" },
  { value: "illustration", label: "일러스트", phrase: "digital illustration, clean lines, vibrant colors" },
  { value: "anime", label: "애니메이션", phrase: "anime style, cel shading, expressive characters" },
  { value: "watercolor", label: "수채화", phrase: "watercolor painting, soft edges, visible paper texture" },
  { value: "render3d", label: "3D", phrase: "3D render, soft studio lighting, detailed materials" },
];

/** 원본 이미지의 실제 가로·세로 (휴대폰 사진의 회전 정보 반영). 읽지 못하면 null. */
async function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size.w > 0 && size.h > 0 ? size : null;
  } catch {
    return null;
  }
}

function closestAspect(w: number, h: number): Aspect {
  // 비율은 로그 거리로 비교해야 가로·세로 쪽이 공평하다 (2:1 과 1:2 가 1:1 에서 같은 거리)
  const r = Math.log(w / h);
  let best: Aspect = "square";
  let bestDist = Infinity;
  for (const a of ASPECTS) {
    const d = Math.abs(Math.log(ASPECT_RATIO[a.value]) - r);
    if (d < bestDist) {
      best = a.value;
      bestDist = d;
    }
  }
  return best;
}

/** 결과 칸에 붙는 '보낸 편집 정보' — 실제로 전송한 마스크 미리보기와 수치 */
function SentDetails({ sent }: { sent: SentView }) {
  const size = (s: { w: number; h: number } | null) => (s ? `${s.w}×${s.h}` : "크기 확인 불가");
  const mismatch =
    sent.mask && sent.source && (sent.mask.width !== sent.source.w || sent.mask.height !== sent.source.h);
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-2.5 text-xs text-muted">
      {sent.mask && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sent.mask.url}
          alt="보낸 마스크 (흰색 = 바꿀 영역)"
          className="h-14 w-14 shrink-0 rounded-md border border-line bg-black object-contain"
        />
      )}
      <div className="min-w-0 leading-relaxed">
        <p className="font-medium text-foreground/80">보낸 편집 정보</p>
        <p>
          원본 {size(sent.source)} {sent.sourceType.replace("image/", "").toUpperCase()} · 편집 강도{" "}
          {sent.strength}% · 비율 {sent.aspect} · {sent.count}장 · {sent.quality}
        </p>
        <p>
          {sent.mask
            ? `마스크 ${sent.mask.width}×${sent.mask.height} · 칠한 영역 ${(sent.mask.whiteRatio * 100).toFixed(2)}%`
            : sent.maskRequested
              ? "칠한 곳이 없어 마스크 없이 이미지 전체를 편집했습니다"
              : "마스크 없음 · 이미지 전체 편집"}
        </p>
        {mismatch && <p className="text-red-500">마스크와 원본 크기가 다릅니다</p>}
      </div>
    </div>
  );
}

export default function ImageStudio() {
  const { adminKey, jobs, start, clear } = useMedia();
  const job = jobs.image;

  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<Aspect>("square");
  const [aspectNote, setAspectNote] = useState<string | null>(null);
  const [style, setStyle] = useState<Style>("none");
  const [quality, setQuality] = useState<Quality>("standard");
  const [count, setCount] = useState(1);
  const [strength, setStrength] = useState(STRENGTH_DEFAULT);
  const [maskOn, setMaskOn] = useState(false);
  const [maskPainted, setMaskPainted] = useState(false);
  const maskRef = useRef<MaskEditorHandle>(null);
  const [sent, setSent] = useState<SentView | null>(null);
  const sentUrlRef = useRef<string | null>(null);
  const source = usePickedImages(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // 크기 읽기는 비동기라, 그 사이 원본을 바꾸거나 뺐으면 늦게 온 결과를 버린다.
  const sizeToken = useRef(0);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const editing = source.items.length > 0;
  const canSubmit = !!adminKey && prompt.trim().length > 0 && !job;
  const stylePhrase = STYLES.find((s) => s.value === style)?.phrase ?? "";

  // 원본이 들어오면 그 비율에 가장 가까운 비율을 골라 둔다 (편집 결과가 잘리거나
  // 찌그러지지 않게). 이후 사용자가 직접 바꾸는 것은 자유다.
  async function matchAspect(file: File) {
    const token = ++sizeToken.current;
    const size = await readImageSize(file);
    if (!size || token !== sizeToken.current) return;
    const a = closestAspect(size.w, size.h);
    setAspect(a);
    const label = ASPECTS.find((x) => x.value === a)?.label;
    setAspectNote(`원본(${size.w}×${size.h})에 맞춰 ${label} 선택됨`);
  }

  function addSource(files: FileList | File[]) {
    const { problem, added } = source.add(files);
    setFormError(problem);
    if (added[0]) void matchAspect(added[0].file);
  }

  // 원본을 빼거나 바꾸면 편집 전용 설정(편집 강도·부분 편집)을 처음 상태로 돌린다.
  // 부분 편집을 끄면 MaskEditor 가 내려가면서 획·캔버스·실행 취소 기록이 모두 사라진다.
  function resetEditOptions() {
    setStrength(STRENGTH_DEFAULT);
    setMaskOn(false);
    setMaskPainted(false);
  }

  // 보낸 편집 정보 표시·해제. 마스크 미리보기 object URL 은 하나만 유지한다.
  function showSent(d: SentEdit | null) {
    if (sentUrlRef.current) URL.revokeObjectURL(sentUrlRef.current);
    sentUrlRef.current = null;
    if (!d) {
      setSent(null);
      return;
    }
    let mask: SentView["mask"] = null;
    if (d.mask) {
      const url = URL.createObjectURL(d.mask.blob);
      sentUrlRef.current = url;
      mask = { url, width: d.mask.width, height: d.mask.height, whiteRatio: d.mask.whiteRatio };
    }
    setSent({ ...d, mask });
  }

  const hideSent = () => showSent(null);

  useEffect(() => {
    return () => {
      if (sentUrlRef.current) URL.revokeObjectURL(sentUrlRef.current);
    };
  }, []);

  function removeSource(key: string) {
    sizeToken.current++;
    setAspectNote(null);
    resetEditOptions();
    source.remove(key);
  }

  function chooseAspect(a: Aspect) {
    sizeToken.current++;
    setAspect(a);
    setAspectNote(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setFormError(null);
    const form = new FormData();
    form.append("prompt", stylePhrase ? `${prompt.trim()}, ${stylePhrase}` : prompt);
    form.append("aspect", aspect);
    form.append("quality", quality);
    form.append("n", String(count));
    let sentDraft: SentEdit | null = null;
    if (editing) {
      // 칠한 곳이 없으면 null — 그때는 mask 없이 이미지 전체를 편집한다.
      let mask: ExportedMask | null = null;
      let sourceFile = source.items[0].file;
      if (maskOn) {
        try {
          mask = (await maskRef.current?.exportMask()) ?? null;
          // 마스크는 화면에 보이는(회전 적용된) 크기로 만들어진다. 원본도 같은 크기가
          // 되도록 휴대폰 사진의 회전 정보를 픽셀에 반영해 보낸다.
          if (mask) sourceFile = await bakeOrientation(sourceFile);
        } catch {
          setSubmitting(false);
          setFormError("마스크를 만들지 못했습니다. 원본 크기를 줄이거나 부분 편집을 꺼 주세요.");
          return;
        }
      }
      form.append("source", sourceFile);
      form.append("edit_strength", String(strength / 100));
      if (mask) form.append("mask", mask.blob, "mask.png");
      sentDraft = {
        strength,
        aspect: ASPECTS.find((a) => a.value === aspect)?.label ?? aspect,
        count,
        quality: QUALITIES.find((q) => q.value === quality)?.label ?? quality,
        source: await readImageSize(sourceFile),
        sourceType: sourceFile.type,
        mask: mask
          ? { blob: mask.blob, width: mask.width, height: mask.height, whiteRatio: mask.whiteRatio }
          : null,
        maskRequested: maskOn,
      };
    }
    const r = await start("image", form);
    setSubmitting(false);
    if (r.ok) {
      setPrompt(""); // 제출에 성공하면 화면에서도 프롬프트를 바로 비운다
      showSent(sentDraft);
    } else {
      setFormError(r.message);
    }
  }

  async function onClear() {
    setClearing(true);
    setClearError(null);
    const r = await clear("image");
    setClearing(false);
    if (!r.ok) {
      setClearError(r.message);
      return;
    }
    // 서버에서 지워진 뒤에야 선택한 파일·파일 input·마스크도 비운다
    sizeToken.current++;
    setAspectNote(null);
    resetEditOptions();
    hideSent();
    source.reset();
    if (fileInput.current) fileInput.current.value = "";
  }

  // 결과 하나를 원본으로 삼아 이어서 편집한다. 서버는 작업을 한 건만 받으므로 현재
  // 작업 내용을 먼저 지운다(문서의 지우기 순서 그대로). 결과 Blob 은 그 전에 파일로
  // 복사해 두므로 지워져도 원본으로 남는다.
  async function editFromResult(r: ResultItem) {
    if (!job) return;
    const type = r.blob.type.split(";")[0].trim().toLowerCase();
    if (!MEDIA_IMAGE_TYPES.includes(type)) {
      setClearError("이 결과 형식은 원본으로 쓸 수 없습니다 (JPG·PNG·WEBP 만 가능).");
      return;
    }
    if (r.blob.size > MEDIA_MAX_FILE_BYTES) {
      setClearError("결과가 25MB 를 넘어 원본으로 쓸 수 없습니다.");
      return;
    }
    const others = Math.max(job.expected, job.results.length) - 1;
    if (
      others > 0 &&
      !window.confirm(
        `이 이미지로 편집하면 나머지 결과 ${others}장은 화면과 서버에서 지워집니다. 필요한 결과는 먼저 저장해 주세요. 계속할까요?`,
      )
    ) {
      return;
    }
    const file = new File([r.blob], `uz-image-${r.index + 1}.${extensionFor(type)}`, { type });

    setClearing(true);
    setClearError(null);
    const res = await clear("image");
    setClearing(false);
    if (!res.ok) {
      setClearError(res.message);
      return;
    }
    resetEditOptions();
    hideSent();
    source.reset();
    if (fileInput.current) fileInput.current.value = "";
    addSource([file]);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    promptRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">이미지 생성·편집</h2>
        <p className="mt-0.5 text-sm text-muted">
          원본 이미지를 올리면 편집하고, 없으면 새로 만듭니다.
        </p>
      </div>

      <Card>
        <form ref={formRef} onSubmit={submit} className="flex scroll-mt-20 flex-col gap-5">
          <ImagePicker
            label="원본 이미지"
            hint="선택 · JPG/PNG/WEBP · 25MB 이하"
            multiple={false}
            max={1}
            picked={source.items}
            inputRef={fileInput}
            onAdd={addSource}
            onRemove={removeSource}
          />

          {editing && (
            <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface/60 p-2.5 sm:p-3.5">
              <div>
                <FieldLabel hint={maskOn ? "칠한 영역 안에서 바꾸는 정도" : "원본을 얼마나 바꿀지"}>
                  편집 강도 <span className="text-accent">{strength}%</span>
                </FieldLabel>
                <input
                  type="range"
                  min={STRENGTH_MIN}
                  max={STRENGTH_MAX}
                  step={5}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                  aria-label="편집 강도"
                  aria-valuetext={`${strength}%`}
                  className="h-8 w-full accent-accent"
                />
                <div className="flex justify-between text-xs text-muted">
                  <span>← 원본 유지</span>
                  <span>많이 변경 →</span>
                </div>
              </div>

              <div>
                <Toggle
                  label="부분 편집"
                  hint="칠한 영역만 바꿉니다"
                  checked={maskOn}
                  onChange={(on) => {
                    setMaskOn(on);
                    setMaskPainted(false);
                  }}
                />
                {maskOn && (
                  <div className="mt-3">
                    <MaskEditor
                      key={source.items[0].key}
                      ref={maskRef}
                      src={source.items[0].url}
                      onPaintedChange={setMaskPainted}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <FieldLabel>프롬프트</FieldLabel>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              autoComplete="off"
              placeholder={editing ? "어떻게 바꿀지 적어 주세요" : "만들 이미지를 설명해 주세요"}
              className={`${inputClass} resize-y`}
            />
          </div>

          <Choice
            label="비율"
            hint={aspectNote ?? undefined}
            value={aspect}
            options={ASPECTS}
            onChange={chooseAspect}
          />
          <Choice
            label="스타일"
            hint={style === "none" ? "고르면 스타일 문구가 프롬프트 끝에 붙습니다" : stylePhrase}
            value={style}
            options={STYLES}
            onChange={setStyle}
          />
          <div className="flex flex-wrap gap-x-8 gap-y-5">
            <Choice label="품질" value={quality} options={QUALITIES} onChange={setQuality} />
            <Choice label="장수" value={count} options={COUNTS} onChange={setCount} />
          </div>

          {formError && (
            <p role="alert" className="text-sm text-red-500">
              {formError}
            </p>
          )}
          {job && (
            <p className="text-xs text-muted">
              새 작업은 아래 현재 작업 내용을 지운 뒤 시작할 수 있습니다.
            </p>
          )}
          {!adminKey && <p className="text-xs text-muted">관리자 키를 먼저 입력해 주세요.</p>}

          <SubmitButton disabled={!canSubmit} busy={submitting}>
            {!editing ? "이미지 생성" : maskOn && maskPainted ? "칠한 영역 편집" : "이미지 편집"}
          </SubmitButton>
        </form>
      </Card>

      {job && (
        <JobPanel
          kind="image"
          job={job}
          clearing={clearing}
          clearError={clearError}
          onClear={onClear}
          onEditResult={editFromResult}
          details={sent && <SentDetails sent={sent} />}
        />
      )}
    </>
  );
}
