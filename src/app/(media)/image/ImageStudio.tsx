"use client";

import { useRef, useState } from "react";
import { useMedia } from "../MediaProvider";
import {
  Card,
  Choice,
  FieldLabel,
  ImagePicker,
  JobPanel,
  SubmitButton,
  inputClass,
  usePickedImages,
} from "../ui";

type Aspect = "square" | "portrait_3_4" | "landscape_4_3" | "portrait_9_16" | "landscape_16_9";
type Quality = "standard" | "high";

const ASPECTS: { value: Aspect; label: string; sub: string }[] = [
  { value: "square", label: "1:1", sub: "정사각" },
  { value: "portrait_3_4", label: "3:4", sub: "세로" },
  { value: "landscape_4_3", label: "4:3", sub: "가로" },
  { value: "portrait_9_16", label: "9:16", sub: "세로" },
  { value: "landscape_16_9", label: "16:9", sub: "가로" },
];

const QUALITIES: { value: Quality; label: string }[] = [
  { value: "standard", label: "표준" },
  { value: "high", label: "고품질" },
];

const COUNTS = [1, 2, 3, 4].map((n) => ({ value: n, label: `${n}장` }));

export default function ImageStudio() {
  const { adminKey, jobs, start, clear } = useMedia();
  const job = jobs.image;

  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<Aspect>("square");
  const [quality, setQuality] = useState<Quality>("standard");
  const [count, setCount] = useState(1);
  const source = usePickedImages(1);
  const fileInput = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const editing = source.items.length > 0;
  const canSubmit = !!adminKey && prompt.trim().length > 0 && !job;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setFormError(null);
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("aspect", aspect);
    form.append("quality", quality);
    form.append("n", String(count));
    if (editing) form.append("source", source.items[0].file);
    const r = await start("image", form);
    setSubmitting(false);
    if (r.ok) setPrompt(""); // 제출에 성공하면 화면에서도 프롬프트를 바로 비운다
    else setFormError(r.message);
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
    // 서버에서 지워진 뒤에야 선택한 파일·파일 input 도 비운다
    source.reset();
    if (fileInput.current) fileInput.current.value = "";
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
        <form onSubmit={submit} className="flex flex-col gap-5">
          <ImagePicker
            label="원본 이미지"
            hint="선택 · JPG/PNG/WEBP · 25MB 이하"
            multiple={false}
            max={1}
            picked={source.items}
            inputRef={fileInput}
            onAdd={(files) => setFormError(source.add(files))}
            onRemove={source.remove}
          />

          <div>
            <FieldLabel>프롬프트</FieldLabel>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              autoComplete="off"
              placeholder={editing ? "어떻게 바꿀지 적어 주세요" : "만들 이미지를 설명해 주세요"}
              className={`${inputClass} resize-y`}
            />
          </div>

          <Choice label="비율" value={aspect} options={ASPECTS} onChange={setAspect} />
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
            {editing ? "이미지 편집" : "이미지 생성"}
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
        />
      )}
    </>
  );
}
