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

export const ALLOWED_TYPES: readonly string[] = [
  ...ALLOWED_IMAGE_TYPES,
  PDF_TYPE,
];
export const ACCEPT = ALLOWED_TYPES.join(",");

export function isImageMediaType(t: string): t is ImageMediaType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(t);
}

export function isAllowedType(t: string): boolean {
  return ALLOWED_TYPES.includes(t);
}
