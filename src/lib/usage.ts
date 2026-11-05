// 사용량/접속 집계 헬퍼 — 모두 best-effort(실패해도 요청 흐름을 절대 막지 않음).
// conversations/messages 와 분리된 누적 카운터/원장/접속로그에 기록한다.
// (스키마·RPC 정의는 db/usage_tracking.sql 참고)

import type { SupabaseClient } from "@supabase/supabase-js";

// 접속자 IP. Next 16 에선 request.ip 가 제거돼 헤더로 읽는다.
//
// ⚠️ X-Forwarded-For 의 첫 값을 믿으면 안 된다. Render 는 클라이언트가 보낸
// X-Forwarded-For 를 지우지 않고 뒤에 덧붙이기만 하므로, 해외에서
// "X-Forwarded-For: <한국 IP>" 한 줄만 붙이면 해외 차단과 IP 별 횟수 제한이
// 모두 우회됐다 (2026-11-05 운영 서버에서 실제 확인).
//
// Render 는 Cloudflare 뒤에 있어(응답에 Server: cloudflare, CF-RAY) Cloudflare 가
// 연결 당사자의 IP 로 덮어쓰는 CF-Connecting-IP 가 함께 온다. 클라이언트가 이 헤더를
// 직접 보내면 Cloudflare 가 요청 자체를 거절한다(403, 실측). 이 값을 우선 쓴다.
//
// 우선순위: CLIENT_IP_HEADER(환경변수로 지정한 헤더) > cf-connecting-ip
//           > true-client-ip > x-forwarded-for 의 '마지막' 값 > x-real-ip
// X-Forwarded-For 폴백에서 마지막 값을 쓰는 이유: 가장 가까운 신뢰 프록시가
// 실제 접속 상대를 맨 뒤에 덧붙이므로, 클라이언트가 앞에 무엇을 써 넣어도 영향이 없다.
export function clientIp(req: Request): string | null {
  const custom = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  const candidates = [custom, "cf-connecting-ip", "true-client-ip"].filter(
    (h): h is string => !!h,
  );
  for (const name of candidates) {
    const v = req.headers.get(name)?.trim();
    if (v) return v;
  }
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real || null;
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
