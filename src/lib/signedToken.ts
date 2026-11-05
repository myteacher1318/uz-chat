// 서명 토큰 공통 유틸 — 게이트 쿠키(gateAuth)와 관리자 쿠키(adminAuth)가 함께 쓴다.
// Edge(proxy 미들웨어)와 Node(라우트) 양쪽에서 동작하도록 Web Crypto만 사용한다.
// node:crypto import 금지.
//
// 토큰 형식: "<만료시각(ms)>.<hmac(purpose + ":" + 만료시각)>"
// purpose 를 서명 대상에 넣는 이유: 두 쿠키가 같은 COOKIE_SECRET 으로 서명되므로,
// 구분 값이 없으면 게이트 토큰이 관리자 토큰으로도 통과해 버린다.

const encoder = new TextEncoder();

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 길이가 같은 문자열의 상수 시간 비교 (길이가 다르면 즉시 false). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(msg: string): Promise<string> {
  return bufToHex(await crypto.subtle.digest("SHA-256", encoder.encode(msg)));
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

/**
 * 제출된 비밀값과 설정값을 비교한다. 길이 차이가 새지 않도록 양쪽을
 * SHA-256(고정 길이)으로 만든 뒤 상수 시간 비교.
 */
export async function secretMatches(
  submitted: unknown,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected || typeof submitted !== "string") return false;
  const [a, b] = await Promise.all([sha256Hex(submitted), sha256Hex(expected)]);
  return timingSafeEqual(a, b);
}

export async function createSignedToken(
  purpose: string,
  key: string,
  ttlSeconds: number,
): Promise<string> {
  const exp = Date.now() + ttlSeconds * 1000;
  const sig = await hmacHex(key, `${purpose}:${exp}`);
  return `${exp}.${sig}`;
}

export async function verifySignedToken(
  purpose: string,
  key: string | null,
  token: string | undefined | null,
): Promise<boolean> {
  if (!key || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(key, `${purpose}:${expStr}`);
  return timingSafeEqual(sig, expected);
}

/**
 * 쿠키 서명 키. COOKIE_SECRET(길고 임의의 문자열, 권장)이 있으면 그것을 쓰고,
 * 없으면 호출 측이 넘긴 대체 키(비밀번호·접속 코드 자체)로 서명한다.
 * 대체 키로 서명하면 쿠키가 한 번이라도 새었을 때 오프라인 무차별 대입으로
 * 비밀번호·코드가 역산될 수 있으므로 운영에서는 COOKIE_SECRET 을 설정할 것.
 */
export function cookieSigningKey(...fallbacks: (string | undefined)[]): string | null {
  const secret = process.env.COOKIE_SECRET;
  if (typeof secret === "string" && secret.length > 0) return secret;
  for (const f of fallbacks) {
    if (typeof f === "string" && f.length > 0) return f;
  }
  return null;
}
