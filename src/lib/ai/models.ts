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
  // 안전 분류기가 요청을 거절(stop_reason: "refusal")했을 때 서버가 대신 실행할 모델.
  // Opus 5처럼 보안 안전장치가 강화된 모델에만 지정한다. 지정하면 거절된 요청이
  // 빈 응답으로 끝나지 않고 이 모델이 이어서 답한다.
  fallbackModel?: string;
  // 웹 서버 도구(web_search/web_fetch) 세대 — Anthropic 모델 전용.
  //   "latest" → _20260209 계열(동적 필터링 포함). Opus 4.6+/Sonnet 4.6+ 에서만 동작한다.
  //   "basic"  → web_search_20250305 만. Haiku 4.5 처럼 이전 세대 모델용
  //              (이 세대에 _20260209 를 보내면 400).
  // 미지정이면 웹 도구를 붙이지 않는다. GPT 계열은 openai.ts 가 따로 처리한다.
  webTools?: "latest" | "basic";
};

// maxTokens는 채팅에선 사실상 넉넉한 값(32K ≈ 한글 2만자 이상).
// GPT-5.6 패밀리(2026-07-09 출시, Sol/Terra/Luna)는 최대 출력 128K라 여유 있음.
// 비용/사용량은 추후 /admin에서 모니터링해 조정.
export const MODELS: ModelDef[] = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (균형)", provider: "anthropic", maxTokens: 32000, adaptiveThinking: true, webTools: "latest" },
  { id: "claude-opus-5", label: "Claude Opus 5 (고품질)", provider: "anthropic", maxTokens: 32000, adaptiveThinking: true, fallbackModel: "claude-opus-4-8", webTools: "latest" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (빠름/저렴)", provider: "anthropic", maxTokens: 32000, webTools: "basic" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (최신 고성능)", provider: "openai", maxTokens: 32000 },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna (빠름/저렴)", provider: "openai", maxTokens: 32000 },
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

// 기본값: 빠르게 — 낮은 effort로 최소 지연 응답.
export const DEFAULT_THINKING_DEPTH: ThinkingDepth = "fast";

export type DepthParams = { thinking: boolean; effort: Effort };

// ⚠️ "빠르게"도 사고를 끄지 않고 effort만 낮춘다.
// Opus 5/Sonnet 5에서 thinking: disabled 로 두면 두 가지 오작동이 보고돼 있다:
//   1) 도구 호출을 tool_use 블록이 아니라 "본문 텍스트"로 써버린다. 턴은 정상 종료되고
//      오류도 없지만 검색이 실제로 실행되지 않는다 — 웹 검색이 기본 켜져 있는 이 앱에
//      정확히 해당하는 조합이라 조용한 오작동이 된다.
//   2) <thinking> 같은 내부 태그가 응답에 새어나올 수 있다.
// 두 모델 모두 "사고를 끄기보다 effort를 낮추라"가 권장 대응이고, low effort만으로도
// 지연·토큰 절감 효과는 대부분 얻는다. 사고 끄기가 꼭 필요하면 thinking: false 로 되돌리되
// 위 위험을 감수해야 한다.
const DEPTH_PARAMS: Record<ThinkingDepth, DepthParams> = {
  fast: { thinking: true, effort: "low" }, // 적응형 사고 + 낮음 — 가장 빠름
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
