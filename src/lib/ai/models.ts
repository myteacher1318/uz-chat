// 모델 레지스트리 — 클라이언트(드롭다운)와 서버(검증/라우팅)가 공유.
// SDK는 import하지 않는 순수 데이터 모듈이라 클라이언트 번들에 안전하게 포함된다.

export type Provider = "anthropic" | "openai";

export type ModelDef = {
  id: string; // 실제 API 모델 ID
  label: string; // 드롭다운에 보이는 이름
  provider: Provider;
};

export const MODELS: ModelDef[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (균형)", provider: "anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (고품질)", provider: "anthropic" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (빠름/저렴)", provider: "anthropic" },
  { id: "gpt-5.5", label: "GPT-5.5 (최신)", provider: "openai" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini (빠름/저렴)", provider: "openai" },
  { id: "gpt-4o", label: "GPT-4o (범용)", provider: "openai" },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

// 허용 목록에 없으면 기본값으로 fallback (임의 모델 주입 방지 + provider 결정)
export function resolveModel(id: string | undefined): ModelDef {
  const found = typeof id === "string" ? MODELS.find((m) => m.id === id) : undefined;
  return found ?? MODELS.find((m) => m.id === DEFAULT_MODEL)!;
}
