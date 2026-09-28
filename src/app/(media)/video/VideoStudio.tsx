"use client";

import { useRef, useState } from "react";
import { VIDEO_MAX_IMAGES } from "@/lib/mediaApi";
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

type Aspect = "landscape" | "portrait" | "square";
type Quality = "standard" | "high";

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: "landscape", label: "가로" },
  { value: "portrait", label: "세로" },
  { value: "square", label: "정사각" },
];

const QUALITIES: { value: Quality; label: string }[] = [
  { value: "standard", label: "표준" },
  { value: "high", label: "고품질" },
];

export default function VideoStudio() {
  const { adminKey, jobs, start, clear } = useMedia();
  const job = jobs.video;

  const [prompt, setPrompt] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [aspect, setAspect] = useState<Aspect>("landscape");
  const [quality, setQuality] = useState<Quality>("standard");
  const images = usePickedImages(VIDEO_MAX_IMAGES);
  const fileInput = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const canSubmit = !!adminKey && prompt.trim().length > 0 && !job;
  const imageRole =
    images.items.length === 0
      ? "선택 · 최대 9장 · 1장이면 첫 프레임, 2장 이상이면 레퍼런스"
      : images.items.length === 1
        ? "1장 → 첫 프레임으로 씁니다"
        : `${images.items.length}장 → 레퍼런스로 씁니다`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setFormError(null);
    const form = new FormData();
    form.append("prompt", prompt);
    if (dialogue.trim()) form.append("dialogue", dialogue);
    form.append("aspect", aspect);
    form.append("quality", quality);
    // 서버 계약: 같은 필드명(images)으로 0~9장
    for (const p of images.items) form.append("images", p.file);
    const r = await start("video", form);
    setSubmitting(false);
    if (r.ok) {
      // 제출에 성공하면 화면에서도 프롬프트·대사를 바로 비운다
      setPrompt("");
      setDialogue("");
    } else {
      setFormError(r.message);
    }
  }

  async function onClear() {
    setClearing(true);
    setClearError(null);
    const r = await clear("video");
    setClearing(false);
    if (!r.ok) {
      setClearError(r.message);
      return;
    }
    // 서버에서 지워진 뒤에야 선택한 파일·파일 input 도 비운다
    images.reset();
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">영상 생성</h2>
        <p className="mt-0.5 text-sm text-muted">5초 안팎의 짧은 영상을 만듭니다.</p>
      </div>

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <ImagePicker
            label="이미지"
            hint={imageRole}
            multiple
            max={VIDEO_MAX_IMAGES}
            picked={images.items}
            inputRef={fileInput}
            onAdd={(files) => setFormError(images.add(files))}
            onRemove={images.remove}
          />

          <div>
            <FieldLabel>프롬프트</FieldLabel>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              autoComplete="off"
              placeholder="장면과 움직임을 설명해 주세요"
              className={`${inputClass} resize-y`}
            />
          </div>

          <div>
            <FieldLabel hint="선택">대사</FieldLabel>
            <textarea
              value={dialogue}
              onChange={(e) => setDialogue(e.target.value)}
              rows={2}
              autoComplete="off"
              placeholder="인물이 말할 대사"
              className={`${inputClass} resize-y`}
            />
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-5">
            <Choice label="비율" value={aspect} options={ASPECTS} onChange={setAspect} />
            <Choice label="품질" value={quality} options={QUALITIES} onChange={setQuality} />
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
            영상 생성
          </SubmitButton>
        </form>
      </Card>

      {job && (
        <JobPanel
          kind="video"
          job={job}
          clearing={clearing}
          clearError={clearError}
          onClear={onClear}
        />
      )}
    </>
  );
}
