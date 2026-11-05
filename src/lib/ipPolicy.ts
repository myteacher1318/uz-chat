// 접속 IP 별 정책 — "믿을 수 있는 IP" 인지에 따라 /api/chat 의 비용 보호 제한을
// 적용할지 정한다 (관리자 결정, 2026-11-05).
//
//   trusted    : 제한 없음(기존 동작 그대로).
//                - 이 정책이 도입되기 전(TRUST_GRANDFATHER_BEFORE 이전)에 접속 기록이
//                  있던 IP (기존 사용자)
//                - 그 뒤 새로 온 IP 라도 접속 기록(access_log.hits)이
//                  TRUST_AFTER_HITS 회 이상 쌓인 IP
//   limited    : 처음 보는 IP — 요청 빈도·히스토리 길이·첨부 개수 제한을 건다.
//   restricted : 관리자가 /admin 에서 '제한 IP' 로 등록한 IP — 접속 횟수와 무관하게
//                항상 limited 와 같은 제한을 건다. (허용 목록은 일부러 두지 않는다 —
//                관리자 화면에서 허용을 추가할 수 있으면 그 자체가 우회 수단이 된다)
//
// 판정은 access_log(기존 컬럼만 사용)와 restricted_ips(db/ip_rules.sql) 두 테이블을
// 읽는다. restricted_ips 테이블이 아직 없으면 '제한 IP 없음' 으로 보고 넘어간다.
// 조회 실패 시에는 limited(안전한 쪽)로 판정한다.

import type { SupabaseClient } from "@supabase/supabase-js";

export type IpPolicy = "trusted" | "limited" | "restricted";

// 이 시각 이전에 처음 접속한 IP 는 기존 사용자로 보고 신뢰한다 (KST 2026-11-06 0시).
export const TRUST_GRANDFATHER_BEFORE = "2026-11-06T00:00:00+09:00";
// 새 IP 가 이 횟수 이상 접속하면 신뢰한다 (페이지 로드·메시지 전송마다 1회).
export const TRUST_AFTER_HITS = 5;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { policy: IpPolicy; expiresAt: number }>();
let warnedMissingTable = false;

/** 관리자가 제한 목록을 바꿨을 때 캐시를 비운다 (같은 프로세스 안에서 즉시 반영). */
export function invalidateIpPolicy(ip?: string): void {
  if (ip) cache.delete(ip);
  else cache.clear();
}

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  // PostgREST: 42P01 undefined_table / PGRST205 schema cache miss
  return code === "42P01" || code === "PGRST205" || /restricted_ips/.test(msg);
}

/** 제한 IP 목록에 있는가. 테이블이 없으면 false (한 번만 경고). */
export async function isRestrictedIp(
  supabase: SupabaseClient,
  ip: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("restricted_ips")
    .select("ip")
    .eq("ip", ip)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn(
          "[ipPolicy] restricted_ips 테이블이 없습니다 — db/ip_rules.sql 을 Supabase 에서 실행하세요.",
        );
      }
      return false;
    }
    throw error;
  }
  return !!data;
}

/** access_log 기준으로 기존 사용자(또는 충분히 접속한 IP)인가. */
async function isKnownIp(supabase: SupabaseClient, ip: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("access_log")
    .select("first_seen, hits")
    .eq("ip", ip)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const firstSeen = new Date(String(data.first_seen)).getTime();
  const hits = Number(data.hits) || 0;
  return (
    (Number.isFinite(firstSeen) &&
      firstSeen < new Date(TRUST_GRANDFATHER_BEFORE).getTime()) ||
    hits >= TRUST_AFTER_HITS
  );
}

/**
 * IP 정책 판정. 결과는 60초 캐시된다 (chat 요청마다 DB 를 두 번 읽지 않도록).
 * IP 를 알 수 없으면(헤더 없음 — 로컬 개발 등) 제한하지 않는다.
 */
export async function getIpPolicy(
  supabase: SupabaseClient | null,
  ip: string | null,
): Promise<IpPolicy> {
  if (!ip || !supabase) return "trusted";
  const now = Date.now();
  const hit = cache.get(ip);
  if (hit && hit.expiresAt > now) return hit.policy;

  let policy: IpPolicy;
  try {
    const [restricted, known] = await Promise.all([
      isRestrictedIp(supabase, ip),
      isKnownIp(supabase, ip),
    ]);
    policy = restricted ? "restricted" : known ? "trusted" : "limited";
  } catch (err) {
    console.error("[ipPolicy] lookup failed — applying limits", err);
    policy = "limited";
  }

  if (cache.size > 2000) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }
  cache.set(ip, { policy, expiresAt: now + CACHE_TTL_MS });
  return policy;
}

/** 관리자 화면 표시용 — access_log 행에서 자동 판정(제한 목록 제외)을 계산한다. */
export function autoTrusted(row: { first_seen: string | null; hits: number }): boolean {
  const t = row.first_seen ? new Date(row.first_seen).getTime() : NaN;
  return (
    (Number.isFinite(t) && t < new Date(TRUST_GRANDFATHER_BEFORE).getTime()) ||
    row.hits >= TRUST_AFTER_HITS
  );
}
