// 사용량/접속 집계 헬퍼 — 모두 best-effort(실패해도 요청 흐름을 절대 막지 않음).
// conversations/messages 와 분리된 누적 카운터/원장/접속로그에 기록한다.
// (스키마·RPC 정의는 db/usage_tracking.sql 참고)

import type { SupabaseClient } from "@supabase/supabase-js";

// x-forwarded-for(프록시가 세팅) 우선, 없으면 x-real-ip.
// Next 16 에선 request.ip 가 제거됨 → 헤더로 읽는다.
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

// 누적 카운터 증가. 0 인 항목은 보내지 않는다.
export async function bumpCounters(
  supabase: SupabaseClient,
  deltas: Record<string, number>,
): Promise<void> {
  try {
    const filtered: Record<string, number> = {};
    for (const [k, v] of Object.entries(deltas)) {
      if (Number.isFinite(v) && v !== 0) filtered[k] = Math.trunc(v);
    }
    if (Object.keys(filtered).length === 0) return;
    const { error } = await supabase.rpc("bump_usage_counters", {
      p_deltas: filtered,
    });
    if (error) throw error;
  } catch (err) {
    console.error("[usage:bumpCounters]", err);
  }
}

// 응답 1건(토큰 포함) 기록.
export async function recordUsageEvent(
  supabase: SupabaseClient,
  u: { provider: string; model: string; input: number; output: number },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("record_usage_event", {
      p_provider: u.provider,
      p_model: u.model,
      p_input: Math.max(0, Math.trunc(u.input) || 0),
      p_output: Math.max(0, Math.trunc(u.output) || 0),
    });
    if (error) throw error;
  } catch (err) {
    console.error("[usage:recordUsageEvent]", err);
  }
}

// 접속 IP 기록 (upsert).
export async function recordAccess(
  supabase: SupabaseClient,
  ip: string | null,
  ua: string | null,
): Promise<void> {
  try {
    if (!ip) return;
    const { error } = await supabase.rpc("record_access", {
      p_ip: ip,
      p_ua: ua ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error("[usage:recordAccess]", err);
  }
}
