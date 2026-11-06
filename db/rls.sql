-- ============================================================================
-- UZ Chat · 테이블 보안(RLS) 잠금 (2026-11-05)
-- ----------------------------------------------------------------------------
-- 이 앱의 서버는 Supabase 를 service role 키로만 호출한다 (src/lib/supabaseServer.ts).
-- service role 은 RLS 를 우회하므로, 아래처럼 모든 테이블에 RLS 를 켜고 anon /
-- authenticated 역할의 권한을 거두어도 앱 동작에는 영향이 없다.
-- 반대로 이 설정이 없으면, 프로젝트의 공개(anon) 키만 알면 누구나 REST 로 대화 내용과
-- 접속 로그(학생 IP)를 읽고 누적치를 고칠 수 있다.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 아래 전체를 붙여넣고 Run.
--         (여러 번 실행해도 안전. 없는 테이블은 건너뛴다)
-- 확인: 대시보드 → Advisors → Security Advisor 에 "RLS disabled" 경고가 없어야 한다.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'conversations', 'messages', 'settings',
    'usage_counters', 'usage_events', 'access_log', 'restricted_ips'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- RPC 함수도 서버 전용 — anon/authenticated 가 호출하지 못하게 한다.
-- (있는 서명만 처리 — usage_tracking.sql 의 버전에 따라 record_usage_event 인자 수가 다르다)
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.bump_usage_counters(jsonb)',
    'public.record_usage_event(text, text, integer, integer)',
    'public.record_usage_event(text, text, integer, integer, text)',
    'public.record_access(text, text)'
  ]
  loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from anon, authenticated', f);
    end if;
  end loop;
end $$;
