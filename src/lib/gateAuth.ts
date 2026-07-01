// 접속 게이트(대문) 인증 — 관리자 인증(adminAuth)과 동일한 HMAC 서명 쿠키 방식.
// Edge(proxy 미들웨어)와 Node(라우트) 양쪽에서 동작하도록 Web Crypto만 사용한다.
// 키는 ACCESS_CODE(8자리 숫자 등). ACCESS_CODE 미설정이면 게이트는 비활성(무검문).

const encoder = new TextEncoder();

export const GATE_COOKIE = "uz_gate";
export const GATE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30일

// ACCESS_CODE 가 설정돼 있을 때만 게이트가 켜진다.
export function isGateEnabled(): boolean {
  const code = process.env.ACCESS_CODE;
  return typeof code === "string" && code.length > 0;
}

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

// 제출된 코드와 ACCESS_CODE 비교 (서버 전용). 길이 노출을 피하려고
// 양쪽을 SHA-256(고정 길이)으로 만든 뒤 상수 시간 비교.
export async function checkAccessCode(submitted: unknown): Promise<boolean> {
  const code = process.env.ACCESS_CODE;
  if (!code || typeof submitted !== "string") return false;
  const a = await sha256Hex(submitted.trim());
  const b = await sha256Hex(code);
  return timingSafeEqualHex(a, b);
}

// 쿠키 토큰: "<exp>.<hmac(exp)>" — ACCESS_CODE 를 키로 서명.
export async function createGateToken(): Promise<string> {
  const code = process.env.ACCESS_CODE;
  if (!code) throw new Error("ACCESS_CODE 미설정");
  const exp = Date.now() + GATE_TTL_SECONDS * 1000;
  const sig = await hmacHex(code, String(exp));
  return `${exp}.${sig}`;
}

export async function verifyGateToken(
  token: string | undefined | null,
): Promise<boolean> {
  const code = process.env.ACCESS_CODE;
  if (!code || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(code, expStr);
  return timingSafeEqualHex(sig, expected);
}
