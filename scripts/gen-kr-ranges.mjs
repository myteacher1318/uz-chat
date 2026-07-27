// 한국(KR) IP 대역표 생성기 — src/lib/geo/krRanges.ts 를 다시 만든다.
//
// 출처: APNIC 공식 할당 통계 (KRNIC 할당분이 여기에 포함된다)
//   https://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-latest
//
// 실행:
//   node scripts/gen-kr-ranges.mjs              # 네트워크에서 내려받아 생성
//   node scripts/gen-kr-ranges.mjs ./apnic.txt  # 이미 받아둔 파일로 생성
//
// 갱신 주기: IP 할당은 천천히 바뀐다. 6~12개월에 한 번이면 충분하고,
//            한국에서 접속이 막히는 일이 생기면 그때 바로 돌리면 된다.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE_URL =
  "https://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-latest";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(here, "..", "src", "lib", "geo", "krRanges.ts");

// ── IP 파싱 ────────────────────────────────────────────────

function ipv4ToInt(s) {
  const p = s.split(".");
  if (p.length !== 4) throw new Error(`잘못된 IPv4: ${s}`);
  let n = 0;
  for (const part of p) {
    const b = Number(part);
    if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error(`잘못된 IPv4: ${s}`);
    n = n * 256 + b;
  }
  return n;
}

// '::' 축약과 끝자리 IPv4 표기(::ffff:1.2.3.4)를 모두 처리한다.
function ipv6ToBigInt(s) {
  let str = s.trim().toLowerCase();

  // 끝이 IPv4 표기면 16진 두 그룹으로 바꾼다.
  const v4 = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    const hi = (n >>> 16).toString(16);
    const lo = (n & 0xffff).toString(16);
    str = str.slice(0, v4.index) + `${hi}:${lo}`;
  }

  const halves = str.split("::");
  if (halves.length > 2) throw new Error(`잘못된 IPv6: ${s}`);

  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) throw new Error(`잘못된 IPv6: ${s}`);
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) throw new Error(`잘못된 IPv6: ${s}`);

  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error(`잘못된 IPv6: ${s}`);
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

// ── 구간 병합 ──────────────────────────────────────────────
// 정렬 후 인접(end + 1 === next.start)하거나 겹치는 구간을 하나로 합친다.
// APNIC 원본은 잘게 쪼개져 있어서 병합하면 항목 수가 크게 줄어든다.
function mergeRanges(ranges, one) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = out[out.length - 1];
    if (cur[0] <= last[1] + one) {
      if (cur[1] > last[1]) last[1] = cur[1];
    } else {
      out.push(cur);
    }
  }
  return out;
}

// ── 원본 파싱 ──────────────────────────────────────────────
// 형식: registry|cc|type|start|value|date|status[|extensions]
//   ipv4 → value 는 "주소 개수" (2의 거듭제곱이 아닐 수 있음)
//   ipv6 → value 는 "프리픽스 길이"
function parse(text) {
  const v4 = [];
  const v6 = [];
  let skipped = 0;

  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|");
    if (f.length < 7) continue;
    const [, cc, type, start, value, , status] = f;
    if (cc !== "KR") continue;
    // 실제로 쓰이는 대역만 (available/reserved 는 제외)
    if (status !== "allocated" && status !== "assigned") continue;

    try {
      if (type === "ipv4") {
        const s = ipv4ToInt(start);
        const count = Number(value);
        if (!Number.isInteger(count) || count <= 0) throw new Error("개수 오류");
        v4.push([s, s + count - 1]);
      } else if (type === "ipv6") {
        const s = ipv6ToBigInt(start);
        const len = Number(value);
        if (!Number.isInteger(len) || len < 0 || len > 128) throw new Error("길이 오류");
        v6.push([s, s + (1n << (128n - BigInt(len))) - 1n]);
      }
    } catch {
      skipped += 1;
    }
  }
  return { v4, v6, skipped };
}

// ── 출력 ───────────────────────────────────────────────────

function emit(v4, v6, sourceNote) {
  // IPv4: [start,end,start,end,...] 평탄 배열 (uint32 숫자)
  const flat4 = v4.flat().join(",");
  // IPv6: 32자 고정폭 16진 문자열. 길이가 같으므로 사전식 비교 = 수치 비교라
  //       BigInt 없이 이진 탐색이 되고, tsconfig target(ES2017)에도 걸리지 않는다.
  const toHex32 = (n) => n.toString(16).padStart(32, "0");
  const flat6 = v6.flat().map((n) => `"${toHex32(n)}"`).join(",");

  return `// ⚠️ 자동 생성 파일 — 직접 수정하지 말 것.
// 재생성: node scripts/gen-kr-ranges.mjs
// 출처: APNIC 공식 할당 통계 (${sourceNote})
// IPv4 구간 ${v4.length}개 · IPv6 구간 ${v6.length}개

/** IPv4 구간을 [시작,끝,시작,끝,...] 으로 평탄화한 배열 (시작값 오름차순). */
export const KR_IPV4: readonly number[] = [${flat4}];

/**
 * IPv6 구간을 [시작,끝,시작,끝,...] 으로 평탄화한 배열.
 * 각 값은 32자 고정폭 소문자 16진 문자열이라 사전식 비교로 대소를 판정할 수 있다.
 */
export const KR_IPV6: readonly string[] = [${flat6}];
`;
}

// ── main ───────────────────────────────────────────────────

const localFile = process.argv[2];
let text;
if (localFile) {
  console.log(`로컬 파일 사용: ${localFile}`);
  text = readFileSync(localFile, "utf8");
} else {
  console.log(`내려받는 중: ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`내려받기 실패: HTTP ${res.status}`);
  text = await res.text();
}

const { v4, v6, skipped } = parse(text);
if (v4.length === 0) throw new Error("KR IPv4 대역을 찾지 못했습니다 — 원본 형식을 확인하세요.");

const merged4 = mergeRanges(v4, 1);
const merged6 = mergeRanges(v6, 1n);

const today = new Date().toISOString().slice(0, 10);
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, emit(merged4, merged6, `${today} 기준`), "utf8");

const total4 = merged4.reduce((s, [a, b]) => s + (b - a + 1), 0);
console.log(`IPv4: 원본 ${v4.length}개 → 병합 ${merged4.length}개 (주소 ${total4.toLocaleString()}개)`);
console.log(`IPv6: 원본 ${v6.length}개 → 병합 ${merged6.length}개`);
if (skipped) console.log(`건너뜀: ${skipped}줄 (파싱 실패)`);
console.log(`생성 완료: ${OUT_PATH}`);
