// provider 중립 메시지 표현. 라우트가 이걸 만들고, 각 provider 모듈이
// 자기 포맷(Anthropic 블록 / OpenAI parts)으로 변환한다.

export type NeutralAttachment = {
  kind: "inline" | "file";
  name: string;
  mediaType: string;
  data?: string; // 인라인 base64 (작은 파일)
  fileId?: string; // Files API 참조 (Anthropic 전용)
};

export type NeutralMessage = {
  role: "user" | "assistant";
  text: string;
  attachments: NeutralAttachment[];
};

// 전송 모드 — 클라이언트(ChatClient)와 /api/chat 이 공유.
//   normal: 새 질문 / regenerate: 같은 질문으로 응답만 다시 / edit: 마지막 턴 교체
export type TurnMode = "normal" | "regenerate" | "edit";

export type Effort = "low" | "medium" | "high";
export type WebToolsTier = "latest" | "basic";

// 스트리밍 호출 옵션 — claude.ts 와 openai.ts 가 같은 시그니처를 받는다.
// Anthropic 전용 옵션은 OpenAI 경로에서 무시된다.
export interface StreamOptions {
  model: string;
  system: string;
  messages: NeutralMessage[];
  maxTokens: number;
  // 사고(thinking) 사용 여부 — adaptive thinking 지원 모델에서만 지정할 것.
  //   true  → thinking: adaptive (모델이 필요할 때 스스로 사고)
  //   false → thinking: disabled (사고 끔. Opus 5.5·Fable 5.1·Sonnet 5.5 는 400)
  //   undefined → 파라미터 미전송 (미지원 모델용)
  thinking?: boolean;
  // 사고 깊이 → output_config.effort. thinking과 마찬가지로 지원 모델에서만.
  effort?: Effort;
  // 웹 서버 도구(검색·페이지 읽기) 사용 여부. Claude 는 web_search/web_fetch 서버
  // 도구, GPT 는 Responses API 의 web_search 도구를 쓴다.
  webSearch?: boolean;
  // 웹 서버 도구 세대 — models.ts 의 ModelDef.webTools 를 그대로 넘긴다 (Anthropic 전용).
  // 미지정이면 webSearch 가 true 여도 도구를 붙이지 않는다(해당 모델이 미지원).
  webTools?: WebToolsTier;
  // 안전 분류기가 요청을 거절했을 때 서버가 대신 실행할 모델 (Opus 5.5·Fable 5.1 등).
  // 미지정이면 폴백 없이 거절이 그대로 반환된다 (Anthropic 전용).
  fallbackModel?: string;
  // 프롬프트 캐싱 사용 여부 (Anthropic 전용). 히스토리가 append-only 인
  // 동안만 켤 것 — 슬라이딩 윈도우가 시작되면 프리픽스가 바뀌어 캐시가
  // 매번 빗나가면서 쓰기 비용(1.25x)만 든다.
  cache?: boolean;
  // 응답 종료 시 토큰 사용량을 알려준다 (사용량 집계용). best-effort.
  onUsage?: (u: { input: number; output: number }) => void;
}
