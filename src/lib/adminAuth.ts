// 관리자 인증 — HMAC 서명 쿠키. Edge(미들웨어)와 Node(라우트) 양쪽에서 동작하도록
// Web Crypto만 사용한다 (signedToken.ts). node:crypto import 금지.
//
// 토큰 서명 키: COOKIE_SECRET(권장) > ADMIN_PASSWORD(fallback).
// 비밀번호 자체로 서명하면 쿠키가 한 번이라도 새었을 때 오프라인 무차별 대입으로
// 비밀번호가 역산될 수 있다. 운영에서는 COOKIE_SECRET 을 설정할 것.

import {
  cookieSigningKey,
  createSignedToken,
  secretMatches,
  verifySignedToken,
} from "./signedToken";

export const ADMIN_COOKIE = "uz_admin";
export const ADMIN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7일
const PURPOSE = "admin";

function signingKey(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return cookieSigningKey(password);
}

// 제출된 비밀번호와 ADMIN_PASSWORD 비교 (서버 전용).
export async function checkPassword(submitted: unknown): Promise<boolean> {
  return secretMatches(submitted, process.env.ADMIN_PASSWORD);
}

// 사용자가 손으로 위조할 수 없고("admin=true" 류 금지), 서버에서만 검증 가능.
export async function createToken(): Promise<string> {
  const key = signingKey();
  if (!key) throw new Error("ADMIN_PASSWORD 미설정");
  return createSignedToken(PURPOSE, key, ADMIN_TTL_SECONDS);
}

export async function verifyToken(
  token: string | undefined | null,
): Promise<boolean> {
  return verifySignedToken(PURPOSE, signingKey(), token);
}
