// IP → 한국 여부 판정. 외부 API 없이 저장소에 커밋된 대역표만 사용한다.
// 대역표 갱신: node scripts/gen-kr-ranges.mjs  (krRanges.ts 재생성)
//
// 판정은 3값이다 — "모름"을 별도로 두는 게 핵심.
//   "kr"      : 한국 대역에 확실히 포함
//   "foreign" : 공인 IP인데 한국 대역에 없음
//   "unknown" : 파싱 실패 / 사설·루프백 IP / IP 자체가 없음
// 차단은 "foreign" 일 때만 한다. 헬스체크·내부 트래픽·파싱 실패를 막지 않기 위해서다.

import { KR_IPV4, KR_IPV6 } from "./krRanges";

export type IpCountry = "kr" | "foreign" | "unknown";

/** IPv4 매핑 IPv6(::ffff:0:0/96)의 32자 hex 프리픽스. */
const V4_MAPPED_PREFIX = "00000000000000000000ffff";

// ── 파싱 ───────────────────────────────────────────────────

/** 점 4개 표기 → uint32. 실패 시 null. (비트연산은 부호 문제가 있어 산술로 계산) */
function ipv4ToInt(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    // "01" 같은 선행 0이나 빈 문자열, 공백을 모두 걸러낸다.
    if (!/^\d{1,3}$/.test(part)) return null;
    const b = Number(part);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

/**
 * IPv6 문자열 → 32자 고정폭 소문자 16진 문자열. 실패 시 null.
 * '::' 축약과 끝자리 IPv4 표기(::ffff:1.2.3.4)를 지원한다.
 * 길이가 항상 같으므로 결과끼리는 사전식 비교로 대소를 판정할 수 있다.
 */
function ipv6ToHex32(s: string): string | null {
  let str = s.toLowerCase();

  const v4 = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    str = str.slice(0, v4.index) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = str.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];

  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let hex = "";
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    hex += g.padStart(4, "0");
  }
  return hex;
}

// ── 구간 탐색 (이진 탐색) ──────────────────────────────────
// 대역표는 [시작,끝,시작,끝,...] 평탄 배열이고 시작값 오름차순으로 정렬돼 있다.

function inRanges4(value: number, flat: readonly number[]): boolean {
  let lo = 0;
  let hi = flat.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (value < flat[mid * 2]) hi = mid - 1;
    else if (value > flat[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// 32자 고정폭 16진 문자열끼리의 비교라 사전식 순서가 곧 수치 순서다.
function inRanges6(value: string, flat: readonly string[]): boolean {
  let lo = 0;
  let hi = flat.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (value < flat[mid * 2]) hi = mid - 1;
    else if (value > flat[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// ── 사설/특수 대역 ─────────────────────────────────────────
// 여기에 걸리면 국가를 따질 수 없으므로 "unknown" (= 통과).

function isPrivateV4(n: number): boolean {
  return (
    n >>> 24 === 10 || // 10.0.0.0/8
    n >>> 24 === 127 || // 127.0.0.0/8 루프백
    (n >= 0xac100000 && n <= 0xac1fffff) || // 172.16.0.0/12
    (n >= 0xc0a80000 && n <= 0xc0a8ffff) || // 192.168.0.0/16
    (n >= 0xa9fe0000 && n <= 0xa9feffff) || // 169.254.0.0/16 링크로컬
    (n >= 0x64400000 && n <= 0x647fffff) || // 100.64.0.0/10 CGNAT
    n === 0
  );
}

// 32자 16진 문자열의 앞부분만 보면 되므로 프리픽스 비교로 충분하다.
function isPrivateV6(hex: string): boolean {
  if (hex === "0".repeat(32)) return true; // ::
  if (hex === `${"0".repeat(31)}1`) return true; // ::1
  const b0 = hex.slice(0, 2);
  if (b0 === "fc" || b0 === "fd") return true; // fc00::/7 유니크 로컬
  const n3 = hex.slice(0, 3);
  if (n3 === "fe8" || n3 === "fe9" || n3 === "fea" || n3 === "feb") {
    return true; // fe80::/10 링크로컬
  }
  return false;
}

// ── 공개 API ───────────────────────────────────────────────

/**
 * IP 문자열의 한국 여부를 판정한다.
 * 판정 불가(사설 IP·파싱 실패·null)는 "unknown" — 호출 측에서 통과시킬 것.
 */
export function classifyIp(ip: string | null | undefined): IpCountry {
  if (!ip) return "unknown";

  // 대괄호([::1]), 존 인덱스(%eth0) 제거
  let s = ip.trim().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!s) return "unknown";

  // IPv4에 포트가 붙은 형태(1.2.3.4:5678)면 포트를 떼어낸다.
  // (IPv6는 콜론이 원래 많으므로 점이 있을 때만 적용)
  if (s.includes(".") && s.includes(":")) {
    const [host] = s.split(":");
    if (host && ipv4ToInt(host) !== null) s = host;
  }

  if (s.includes(":")) {
    const hex = ipv6ToHex32(s);
    if (hex === null) return "unknown";

    // IPv4 매핑 IPv6는 IPv4로 되돌려 판정한다. 축약형(::ffff:1.2.3.4)과
    // 비축약형(0:0:0:0:0:ffff:1.2.3.4)이 모두 같은 hex로 정규화되므로 여기서 한 번에 처리된다.
    // (이 처리를 빼면 비축약형으로 들어온 한국 IP가 해외로 오판된다)
    if (hex.startsWith(V4_MAPPED_PREFIX)) {
      const v4 = parseInt(hex.slice(V4_MAPPED_PREFIX.length), 16);
      if (isPrivateV4(v4)) return "unknown";
      return inRanges4(v4, KR_IPV4) ? "kr" : "foreign";
    }

    if (isPrivateV6(hex)) return "unknown";
    return inRanges6(hex, KR_IPV6) ? "kr" : "foreign";
  }

  const n = ipv4ToInt(s);
  if (n === null) return "unknown";
  if (isPrivateV4(n)) return "unknown";
  return inRanges4(n, KR_IPV4) ? "kr" : "foreign";
}

/** 차단 대상인지 — "확실히 해외"일 때만 true. */
export function isForeignIp(ip: string | null | undefined): boolean {
  return classifyIp(ip) === "foreign";
}

/**
 * 해외 IP 차단 기능 on/off. 환경변수 BLOCK_FOREIGN_IPS 가 "1" 또는 "true" 일 때만 켠다.
 * 미설정이면 꺼짐 — 잘못 배포해도 접속이 막히지 않도록 기본값을 안전한 쪽에 둔다.
 */
export function isGeoBlockEnabled(): boolean {
  const v = process.env.BLOCK_FOREIGN_IPS;
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true";
}
