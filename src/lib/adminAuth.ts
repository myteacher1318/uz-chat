// 관리자 인증 유틸 — Edge(미들웨어)와 Node(라우트) 양쪽에서 동작하도록
// Web Crypto API(globalThis.crypto.subtle)만 사용한다. node:crypto import 금지.

const encoder = new TextEncoder();

export const ADMIN_COOKIE = "uz_admin";
export const ADMIN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7일

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 길이가 같은 hex 문자열의 상수 시간 비교
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(msg));
  return bufToHex(sig);
}

async function sha256Hex(msg: string): Promise<string> {
  return bufToHex(await crypto.subtle.digest("SHA-256", encoder.encode(msg)));
}

// 제출된 비밀번호와 ADMIN_PASSWORD 비교 (서버 전용). 길이 노출을 피하려고
// 양쪽을 SHA-256(고정 길이)으로 만든 뒤 상수 시간 비교.
export async function checkPassword(submitted: unknown): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || typeof submitted !== "string") return false;
  const a = await sha256Hex(submitted);
  const b = await sha256Hex(password);
  return timingSafeEqualHex(a, b);
}

// 쿠키 토큰: "<exp>.<hmac(exp)>" — ADMIN_PASSWORD를 키로 서명.
// 사용자가 손으로 위조할 수 없고("admin=true" 류 금지), 서버에서만 검증 가능.
export async function createToken(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD 미설정");
  const exp = Date.now() + ADMIN_TTL_SECONDS * 1000;
  const sig = await hmacHex(password, String(exp));
  return `${exp}.${sig}`;
}

export async function verifyToken(
  token: string | undefined | null,
): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(password, expStr);
  return timingSafeEqualHex(sig, expected);
}
