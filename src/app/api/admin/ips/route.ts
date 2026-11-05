import { getSupabase } from "@/lib/supabaseServer";
import { invalidateIpPolicy } from "@/lib/ipPolicy";

// 보호됨(proxy). 관리자가 관리하는 '제한 IP' 목록.
// 제한 IP 는 접속 횟수와 무관하게 항상 /api/chat 의 비용 보호 제한을 받는다 (ipPolicy.ts).
// 일부러 '허용 IP' 추가는 두지 않는다 — 관리자 화면에서 허용을 늘릴 수 있으면
// 그 화면이 뚫렸을 때 제한 전체가 무력화된다. 제한 해제는 자동 판정으로 돌아갈 뿐이다.
// 테이블: db/ip_rules.sql

const IP_MAX_LEN = 64;

function normalizeIp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  // IPv4/IPv6 에 쓰이는 글자만 허용 (공백·와일드카드 등 거부)
  if (!s || s.length > IP_MAX_LEN || !/^[0-9a-fA-F.:]+$/.test(s)) return null;
  return s.toLowerCase();
}

function describe(err: unknown): { error: string; status: number } {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "42P01" || code === "PGRST205") {
    return {
      error: "restricted_ips 테이블이 없습니다. db/ip_rules.sql 을 Supabase SQL Editor 에서 실행하세요.",
      status: 503,
    };
  }
  return { error: "처리하지 못했습니다.", status: 500 };
}

// GET: 제한 IP 목록
export async function GET(): Promise<Response> {
  try {
    const { data, error } = await getSupabase()
      .from("restricted_ips")
      .select("ip, note, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return Response.json({ rows: data ?? [] });
  } catch (err) {
    console.error("[admin/ips:GET]", err);
    const d = describe(err);
    return Response.json({ error: d.error }, { status: d.status });
  }
}

// POST { ip, note? }: 제한 IP 추가
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const ip = normalizeIp((body as { ip?: unknown } | null)?.ip);
  if (!ip) {
    return Response.json({ error: "올바른 IP 주소를 입력하세요." }, { status: 400 });
  }
  const noteRaw = (body as { note?: unknown } | null)?.note;
  const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 200) || null : null;

  try {
    const { error } = await getSupabase()
      .from("restricted_ips")
      .upsert({ ip, note }, { onConflict: "ip" });
    if (error) throw error;
    invalidateIpPolicy(ip);
    return Response.json({ ok: true, ip });
  } catch (err) {
    console.error("[admin/ips:POST]", err);
    const d = describe(err);
    return Response.json({ error: d.error }, { status: d.status });
  }
}

// DELETE ?ip=...: 제한 해제 (자동 판정으로 돌아간다)
export async function DELETE(req: Request): Promise<Response> {
  const ip = normalizeIp(new URL(req.url).searchParams.get("ip"));
  if (!ip) {
    return Response.json({ error: "올바른 IP 주소를 입력하세요." }, { status: 400 });
  }
  try {
    const { error } = await getSupabase().from("restricted_ips").delete().eq("ip", ip);
    if (error) throw error;
    invalidateIpPolicy(ip);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[admin/ips:DELETE]", err);
    const d = describe(err);
    return Response.json({ error: d.error }, { status: d.status });
  }
}
