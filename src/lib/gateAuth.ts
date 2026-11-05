// 접속 게이트(대문) 인증 — 관리자 인증(adminAuth)과 같은 HMAC 서명 쿠키 방식.
// Edge(proxy 미들웨어)와 Node(라우트) 양쪽에서 동작하도록 Web Crypto만 사용한다.
//
// 켜짐/꺼짐:
//  - ACCESS_CODE 가 설정돼 있으면 게이트가 켜진다.
//  - 프로덕션에서 ACCESS_CODE 가 비어 있으면 "열린 채 운영" 이 아니라 "닫힘" 이다
//    (대시보드에서 값을 지우는 실수로 유료 채팅이 공개되는 일을 막는다). 이때 대문은
//    설정 오류 안내를 보여준다. 일부러 게이트 없이 운영하려면 ALLOW_OPEN_GATE=1.
//  - 개발(NODE_ENV!=production)에서는 ACCESS_CODE 가 없으면 꺼진다(무검문).
//
// 토큰 서명 키: COOKIE_SECRET(권장) > GATE_SECRET > ACCESS_CODE(fallback).
// ACCESS_CODE(8자리 숫자)로 서명하면 토큰이 한 번이라도 유출됐을 때
// 오프라인 무차별 대입(10^8)으로 코드가 역산될 수 있다.
// COOKIE_SECRET 에는 길고 임의의 문자열을 설정할 것 (변경 시 기존 쿠키 전체 무효화).

import {
  cookieSigningKey,
  createSignedToken,
  secretMatches,
  verifySignedToken,
} from "./signedToken";

export const GATE_COOKIE = "uz_gate";
export const GATE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30일
const PURPOSE = "gate";

function accessCode(): string | undefined {
  const code = process.env.ACCESS_CODE;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function openGateAllowed(): boolean {
  const v = process.env.ALLOW_OPEN_GATE?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** 프로덕션인데 ACCESS_CODE 가 비어 있고 명시적 허용도 없는 상태 — 아무도 못 들어간다. */
export function isGateMisconfigured(): boolean {
  return (
    process.env.NODE_ENV === "production" && !accessCode() && !openGateAllowed()
  );
}

// 게이트가 켜져 있는가. 설정 오류 상태도 '켜짐'(= 닫힘)으로 본다.
export function isGateEnabled(): boolean {
  return !!accessCode() || isGateMisconfigured();
}

// 게이트가 켜져 있을 때의 토큰 서명 키. 꺼져 있거나 설정 오류면 null.
function signingKey(): string | null {
  const code = accessCode();
  if (!code) return null;
  return cookieSigningKey(process.env.GATE_SECRET, code);
}

// 제출된 코드와 ACCESS_CODE 비교 (서버 전용).
export async function checkAccessCode(submitted: unknown): Promise<boolean> {
  if (typeof submitted !== "string") return false;
  return secretMatches(submitted.trim(), accessCode());
}

export async function createGateToken(): Promise<string> {
  const key = signingKey();
  if (!key) throw new Error("ACCESS_CODE 미설정");
  return createSignedToken(PURPOSE, key, GATE_TTL_SECONDS);
}

export async function verifyGateToken(
  token: string | undefined | null,
): Promise<boolean> {
  return verifySignedToken(PURPOSE, signingKey(), token);
}
