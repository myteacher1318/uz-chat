// 모델 레지스트리 — 클라이언트(드롭다운)와 서버(검증/라우팅)가 공유.
// SDK는 import하지 않는 순수 데이터 모듈이라 클라이언트 번들에 안전하게 포함된다.

export type Provider = "anthropic" | "openai";

export type ModelDef = {
  id: string; // 실제 API 모델 ID
  label: string; // 드롭다운에 보이는 이름
  provider: Provider;
  maxTokens: number; // 최대 출력 토큰 — 반드시 해당 모델의 출력 한도 이내여야 함
};

// maxTokens는 채팅에선 사실상 넉넉한 값(32K ≈ 한글 2만자 이상).
// 모델별 상한 주의: GPT-4o는 16,384가 하드 상한이라 그 이상 불가.
// 비용/사용량은 추후 /admin에서 모니터링해 조정.
export const MODELS: ModelDef[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (균형)", provider: "anthropic", maxTokens: 32000 },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (고품질)", provider: "anthropic", maxTokens: 32000 },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (빠름/저렴)", provider: "anthropic", maxTokens: 32000 },
  { id: "gpt-5.5", label: "GPT-5.5 (최신)", provider: "openai", maxTokens: 32000 },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini (빠름/저렴)", provider: "openai", maxTokens: 32000 },
  { id: "gpt-4o", label: "GPT-4o (범용)", provider: "openai", maxTokens: 16384 },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

// 허용 목록에 없으면 기본값으로 fallback (임의 모델 주입 방지 + provider 결정)
export function resolveModel(id: string | undefined): ModelDef {
  const found = typeof id === "string" ? MODELS.find((m) => m.id === id) : undefined;
  return found ?? MODELS.find((m) => m.id === DEFAULT_MODEL)!;
}
