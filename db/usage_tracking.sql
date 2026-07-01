-- ============================================================================
-- UZ Chat · 사용량/접속 집계용 스키마
-- ----------------------------------------------------------------------------
-- 목적: 대화를 삭제해도 통계가 사라지지 않도록, 사용량을 conversations/messages
--       테이블과 분리된 "누적 원장/카운터"에 따로 기록한다.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 아래 전체를 붙여넣고 Run.
--         (여러 번 실행해도 안전 — 모두 IF NOT EXISTS / OR REPLACE)
-- ============================================================================

-- 1) 누적 카운터 (단조 증가). 대화가 삭제돼도 절대 줄어들지 않는다.
--    key 예: conversations, user_messages, assistant_messages,
--            input_tokens, output_tokens, attachment_count, attachment_bytes
create table if not exists public.usage_counters (
  key   text primary key,
  value bigint not null default 0
);

-- 2) 토큰/모델 원장 (append-only). 응답 1건당 1행.
--    conversations 를 참조하지 않으므로 대화가 지워져도 남는다.
create table if not exists public.usage_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  provider      text,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0
);
create index if not exists usage_events_created_at_idx
  on public.usage_events (created_at);

-- 3) 접속 IP 누적 기록 (IP별 1행, upsert 로 hits 증가).
create table if not exists public.access_log (
  ip              text primary key,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  hits            bigint not null default 1,
  last_user_agent text
);
create index if not exists access_log_last_seen_idx
  on public.access_log (last_seen desc);

-- ----------------------------------------------------------------------------
-- RPC 함수 (서버 라우트에서 supabase.rpc(...) 로 호출 · 원자적 증가)
-- ----------------------------------------------------------------------------

-- 카운터 원자적 증가: {"key": delta, ...} 형태의 jsonb 를 받아 한 번에 반영.
create or replace function public.bump_usage_counters(p_deltas jsonb)
returns void
language plpgsql
as $$
declare
  k text;
  v bigint;
begin
  for k, v in
    select key, (value)::bigint from jsonb_each_text(p_deltas)
  loop
    insert into public.usage_counters(key, value)
    values (k, v)
    on conflict (key)
      do update set value = usage_counters.value + excluded.value;
  end loop;
end;
$$;

-- 응답 1건 기록: 원장에 1행 insert + 토큰/어시스턴트 카운터 증가 (한 트랜잭션).
create or replace function public.record_usage_event(
  p_provider text,
  p_model    text,
  p_input    integer,
  p_output   integer
)
returns void
language plpgsql
as $$
begin
  insert into public.usage_events(provider, model, input_tokens, output_tokens)
  values (p_provider, p_model, coalesce(p_input, 0), coalesce(p_output, 0));

  perform public.bump_usage_counters(jsonb_build_object(
    'assistant_messages', 1,
    'input_tokens',  coalesce(p_input, 0),
    'output_tokens', coalesce(p_output, 0)
  ));
end;
$$;

-- 접속 기록 upsert: 같은 IP 면 hits +1, last_seen 갱신.
create or replace function public.record_access(p_ip text, p_ua text)
returns void
language plpgsql
as $$
begin
  insert into public.access_log(ip, last_user_agent)
  values (p_ip, p_ua)
  on conflict (ip) do update
    set hits            = access_log.hits + 1,
        last_seen       = now(),
        last_user_agent = coalesce(excluded.last_user_agent,
                                   access_log.last_user_agent);
end;
$$;
