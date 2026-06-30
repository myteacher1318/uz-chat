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
