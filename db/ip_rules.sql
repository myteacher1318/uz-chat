-- ============================================================================
-- UZ Chat · 접속 IP 정책용 스키마 (2026-11-05)
-- ----------------------------------------------------------------------------
-- 처음 보는 IP 에만 /api/chat 의 비용 보호 제한을 걸고(src/lib/ipPolicy.ts),
-- 관리자가 /admin 에서 특정 IP 를 '제한 IP' 로 등록할 수 있게 한다.
--
-- 신뢰 판정 자체는 기존 access_log(first_seen, hits)만으로 하므로 이 파일을
-- 실행하지 않아도 제한은 동작한다. 이 파일은 '제한 IP' 목록(관리자 등록)만 추가한다.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 아래 전체를 붙여넣고 Run.
--         (여러 번 실행해도 안전 — 모두 IF NOT EXISTS)
-- ============================================================================

create table if not exists public.restricted_ips (
  ip         text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- 이 앱은 service role 키로만 접근한다. anon/authenticated 키로는 읽고 쓸 수 없게.
alter table public.restricted_ips enable row level security;
revoke all on public.restricted_ips from anon, authenticated;
