// 클라이언트·서버가 공유하는 첨부 관련 상수/타입/검증.

// 이 크기 이하면 base64로 인라인 전송, 초과하면 Blob 업로드 후 Files API 경로로.
export const INLINE_MAX_BYTES = 2 * 1024 * 1024; // 2MB
// 첨부 1개의 절대 상한 (Files API 경로 포함)
export const MAX_FILE_BYTES = 32 * 1024 * 1024; // 32MB

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type ImageMediaType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const PDF_TYPE = "application/pdf";
export const TEXT_TYPE = "text/plain";

// 텍스트는 별도 상한을 둔다. 이미지·PDF와 달리 내용이 그대로 토큰이 되기 때문에
// 2MB(=INLINE_MAX_BYTES)면 약 50만 토큰이라 한 번 첨부에 수 달러가 나갈 수 있다.
// 200KB는 대략 5만 토큰으로, 수업 자료나 학생 글 한 편에는 넉넉하다.
export const TEXT_MAX_BYTES = 200 * 1024;

export const ALLOWED_TYPES: readonly string[] = [
  ...ALLOWED_IMAGE_TYPES,
  PDF_TYPE,
  TEXT_TYPE,
];
// 파일 선택창 필터 — .txt 는 브라우저가 MIME 을 비워 보내는 경우가 있어
// 확장자도 함께 넣어야 목록에 보인다.
export const ACCEPT = [...ALLOWED_TYPES, ".txt"].join(",");

export function isImageMediaType(t: string): t is ImageMediaType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(t);
}

export function isTextMediaType(t: string): boolean {
  return t === TEXT_TYPE;
}

export function isAllowedType(t: string): boolean {
  return ALLOWED_TYPES.includes(t);
}

/** 형식별 크기 상한 — 텍스트만 더 엄격하다. */
export function maxBytesFor(t: string): number {
  return isTextMediaType(t) ? TEXT_MAX_BYTES : MAX_FILE_BYTES;
}

/** 오류 문구에 쓸 크기 표기 (예: "32MB", "200KB"). */
export function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${Math.round(n / 1024 / 1024)}MB`
    : `${Math.round(n / 1024)}KB`;
}
