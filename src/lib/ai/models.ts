// 모델 레지스트리 — 클라이언트(드롭다운)와 서버(검증/라우팅)가 공유.
// SDK는 import하지 않는 순수 데이터 모듈이라 클라이언트 번들에 안전하게 포함된다.

export type Provider = "anthropic" | "openai";

export type ModelDef = {
  id: string; // 실제 API 모델 ID
  label: string; // 드롭다운에 보이는 이름
  provider: Provider;
  maxTokens: number; // 최대 출력 토큰 — 반드시 해당 모델의 출력 한도 이내여야 함
  // adaptive thinking 지원 모델(Sonnet 4.6+/Opus 4.6+)에서만 true.
  // Haiku 4.5는 adaptive 미지원이라 켜면 400 오류.
  adaptiveThinking?: boolean;
};

// maxTokens는 채팅에선 사실상 넉넉한 값(32K ≈ 한글 2만자 이상).
// 모델별 상한 주의: GPT-4o는 16,384가 하드 상한이라 그 이상 불가.
// 비용/사용량은 추후 /admin에서 모니터링해 조정.
export const MODELS: ModelDef[] = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (균형)", provider: "anthropic", maxTokens: 32000, adaptiveThinking: true },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (고품질)", provider: "anthropic", maxTokens: 32000, adaptiveThinking: true },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (빠름/저렴)", provider: "anthropic", maxTokens: 32000 },
  { id: "gpt-5.5", label: "GPT-5.5 (최신)", provider: "openai", maxTokens: 32000 },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini (빠름/저렴)", provider: "openai", maxTokens: 32000 },
  { id: "gpt-4o", label: "GPT-4o (범용)", provider: "openai", maxTokens: 16384 },
];

export const DEFAULT_MODEL = "claude-sonnet-5";

// 허용 목록에 없으면 기본값으로 fallback (임의 모델 주입 방지 + provider 결정)
export function resolveModel(id: string | undefined): ModelDef {
  const found = typeof id === "string" ? MODELS.find((m) => m.id === id) : undefined;
  return found ?? MODELS.find((m) => m.id === DEFAULT_MODEL)!;
}

// ── 사고 깊이(thinking depth) ─────────────────────────────
// Sonnet 5 / Opus 4.8 등 adaptive thinking 지원 모델에서만 의미가 있다.
// API로는 두 파라미터로 표현된다:
//   - thinking: adaptive(켬) / disabled(끔)
//   - output_config.effort: 사고·응답 토큰 예산 (low|medium|high…)
// Haiku 4.5·GPT 계열은 effort/thinking 모두 미지원이라 이 설정을 보내지 않는다.
export type Effort = "low" | "medium" | "high";
export type ThinkingDepth = "fast" | "standard" | "deep";

export const THINKING_DEPTHS: { id: ThinkingDepth; label: string }[] = [
  { id: "fast", label: "빠르게" },
  { id: "standard", label: "표준" },
  { id: "deep", label: "깊게" },
];

// 기본값: 빠르게 — 사고를 끄고 낮은 effort로 최소 지연 응답.
export const DEFAULT_THINKING_DEPTH: ThinkingDepth = "fast";

export type DepthParams = { thinking: boolean; effort: Effort };

const DEPTH_PARAMS: Record<ThinkingDepth, DepthParams> = {
  fast: { thinking: false, effort: "low" }, // 사고 끔 — 가장 빠름
  standard: { thinking: true, effort: "medium" }, // 적응형 사고 + 중간
  deep: { thinking: true, effort: "high" }, // 적응형 사고 + 높음(더 신중)
};

// 허용 목록에 없으면 기본값(빠르게)으로 fallback.
export function resolveThinkingDepth(id: string | undefined): ThinkingDepth {
  return id === "standard" || id === "deep" ? id : DEFAULT_THINKING_DEPTH;
}

export function depthParams(depth: ThinkingDepth): DepthParams {
  return DEPTH_PARAMS[depth];
}
