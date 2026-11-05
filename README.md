# UZ Chat

학생 한두 명이 쓰는 로그인 없는 Claude/GPT 채팅 앱. 8자리 접속 코드(대문)로 입장하고,
대화는 Supabase 에 저장된다. 이미지·영상 생성 페이지(`/image`, `/video`)는 별도의
Spark 서버를 브라우저에서 직접 호출한다.

- Next.js 16(App Router) · React 19 · TypeScript · Tailwind 4
- 모델: Claude(Sonnet 5.5 기본, Opus 5.5, Fable 5.1, Haiku 5.5) · GPT-6 패밀리
- 배포: Render 무료 플랜(상시 Node 서버) · DB: Supabase · 큰 첨부: Vercel Blob → Anthropic Files API

> 코드 수정 전에 `AGENTS.md` 를 읽을 것 — 이 저장소의 Next.js 는 학습 데이터와 다르다.

## 로컬 실행

```bash
npm install
# .env.local 을 만들고 아래 환경변수 표의 값을 채운다 (.env* 는 커밋되지 않는다)
npm run dev                        # http://localhost:3000
```

- `.env.local` 에 `ACCESS_CODE` 가 없으면 개발 환경에서는 게이트가 꺼진다(무검문).
- 검사: `npx tsc --noEmit` · `npm run lint` · `npm run build`
- 로컬 테스트 메시지는 **새 대화** 를 먼저 누르고 보낼 것 — 안 그러면 실제 대화에 섞인다.

## 환경변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ✔ | Claude 호출 + Files API |
| `OPENAI_API_KEY` | GPT 쓸 때 | Responses API |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✔ | 서버 전용. service role 은 RLS 를 우회하므로 절대 클라이언트에 노출 금지 |
| `ADMIN_PASSWORD` | ✔ | `/admin` 로그인 |
| `ACCESS_CODE` | ✔ (운영) | 대문 접속 코드. **프로덕션에서 비어 있으면 채팅이 닫힌다** (설정 오류 안내 표시). 일부러 열어 두려면 `ALLOW_OPEN_GATE=1` |
| `COOKIE_SECRET` | 권장 | 게이트·관리자 쿠키 서명 키. 없으면 코드/비밀번호 자체로 서명해, 쿠키가 새면 오프라인으로 역산될 수 있다. 바꾸면 모든 사용자가 다시 입장해야 한다 |
| `BLOCK_FOREIGN_IPS` | | `1` 이면 한국 IP 대역(`src/lib/geo/krRanges.ts`, APNIC 기준) 밖의 API 접근을 403 으로 막는다 |
| `BLOB_READ_WRITE_TOKEN` | 큰 첨부 쓸 때 | Vercel Blob 스토어 토큰. 없으면 2MB 초과 첨부가 실패할 뿐 나머지는 동작 |
| `CRON_SECRET` | 운영 | `/api/cleanup` 인증. 미설정이면 프로덕션에서 정리 엔드포인트가 거부된다 |
| `CLIENT_IP_HEADER` | | 접속자 IP 를 읽을 헤더를 강제 지정. 기본은 `cf-connecting-ip` (아래 "접속 IP" 참고) |

비밀값 생성:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## Supabase 설정

SQL Editor 에서 아래 파일을 순서대로 실행한다 (모두 여러 번 실행해도 안전).

1. `db/usage_tracking.sql` — 누적 카운터·토큰 원장·접속 로그 + RPC. 대화를 지워도 통계가 남는 이유.
2. `db/ip_rules.sql` — 관리자가 등록하는 제한 IP 목록(`restricted_ips`).
3. `db/rls.sql` — 모든 테이블에 RLS 를 켜고 anon/authenticated 권한을 거둔다. 이 앱은 service role 만 쓰므로 동작에 영향이 없고, 이게 없으면 공개 anon 키만으로 대화 내용과 접속 로그를 읽을 수 있다. 실행 후 대시보드 → Advisors → Security Advisor 에 경고가 없어야 한다.

`conversations` / `messages` / `settings` 테이블은 초기 구축 때 만든 것이라 이 저장소에
생성 SQL 이 없다. 새 프로젝트를 만들 때는 대시보드에서 같은 이름·컬럼으로 만들 것
(`messages.attachments` 는 jsonb, `settings` 는 id=1 한 행에 `message_history_limit`).

## Render 배포

`render.yaml` 블루프린트로 배포한다 (New → Blueprint → 저장소 연결 → 환경변수 입력).
`main` 에 push 하면 자동 재배포된다. 환경변수를 저장해도 재배포되어 1~2분 끊긴다.

서비스 주소: `https://uz-chat-kcvj.onrender.com`

### 무료 플랜 제약과 keep-alive

무료 인스턴스는 15분 유휴 후 잠들고, 깨어나는 데 25~35초가 걸린다. 외부 크론으로 계속
깨워 두어 이를 막는다. **주의: 크론은 깨어 있는 서비스를 유지할 수는 있어도 잠든 서비스를
깨우지는 못한다.** 콜드 스타트가 끝나기 전에 Render 프록시가 502 를 먼저 돌려주고,
cron-job.org 무료 플랜의 타임아웃 상한(30초)도 그보다 짧기 때문이다.

cron-job.org(무료) 설정:

| 항목 | 값 |
| --- | --- |
| URL | `https://uz-chat-kcvj.onrender.com/` — 반드시 `/` (API 경로 아님) |
| 요청 방식 | **HEAD** (GET 은 응답 본문 1KB 제한에 걸려 매번 실패) |
| 시간대 | Asia/Seoul |
| 스케줄 | 0~23시 전체, 매 10분 (`0,10,20,30,40,50`) — 시간대를 좁히면 공백 중 잠들어 그 뒤로 영원히 실패한다 |

- 최초 기동(배포 직후, 한도 초과 정지 뒤 등)은 사람이 브라우저로 접속해 화면이 뜰 때까지 기다려야 한다.
- 무료 인스턴스 시간은 월 750시간. 24시간 유지는 31일 달에 744시간이라 여유가 6시간뿐이다. 무료 서비스를 하나 더 만들면 바로 한도를 넘는다. 월 사용량을 가끔 확인할 것.
- `/` 를 쓰는 이유: proxy 미들웨어 matcher 에서 제외돼 해외 모니터링 IP 도 차단되지 않고, 모델·DB 를 호출하지 않아 비용이 0 이며, 접속 로그에도 남지 않는다. **`src/proxy.ts` matcher 에 `/` 를 넣지 말 것** — 핑과 Render 헬스체크가 함께 깨진다.
- UptimeRobot 무료 플랜은 쓰지 말 것(시간대 제한이 유료 기능).
- 2026-09-26 Render 엣지 503 으로 keep-alive 가 끊긴 적이 있다. 재발하면 Render Starter(월 $7, 스핀다운 없음)로 올리는 게 답이다. 학생에게 본격 배포할 시점에도 그쪽이 맞다.

### 정기 파일 정리 (`/api/cleanup`)

첨부만 하고 전송하지 않은 파일은 Anthropic Files API 와 Vercel Blob 에 남는다. 이 작업이
24시간 지난 고아 파일을 지운다. 덤으로 매일 DB 를 조회하므로 Supabase 무료 플랜의 7일
유휴 정지도 막는다. Render 는 Vercel 크론을 읽지 않으므로 외부 크론이 필요하다.

1. `CRON_SECRET` 값을 만들어(위 생성 명령) Render 환경변수에 저장.
2. cron-job.org 에 keep-alive 와 별개인 작업을 하나 더 만든다:
   - URL: `https://uz-chat-kcvj.onrender.com/api/cleanup` · 매일 1회
   - 헤더: `Authorization` = `Bearer <CRON_SECRET>` (앞뒤 공백·줄바꿈이 붙으면 401)
3. 확인: 성공 시 `{"totalFiles":n,"referenced":n,"deleted":n,"skipped":n,"errors":n,"blobs":{...}}`.
   `unauthorized` 면 값 불일치 또는 재배포 미완료, 404 면 URL 오타, 502 면 서비스가 잠든 것(keep-alive 확인).

### 접속 IP 와 해외 차단

- 접속자 IP 는 `src/lib/usage.ts` 의 `clientIp()` 가 정한다. Render 는 Cloudflare 뒤에 있어 Cloudflare 가 덮어쓰는 `CF-Connecting-IP` 를 우선 쓴다. `X-Forwarded-For` 의 첫 값은 클라이언트가 마음대로 넣을 수 있어 쓰지 않는다 (실제로 우회됐던 문제).
- 2026-11-05 운영에서 확인한 실제 헤더: `cf-connecting-ip`·`true-client-ip` = 접속자 공인 IP, `x-forwarded-for` = `<접속자>, <Cloudflare 엣지 172.70.x.x>, <Render 내부 10.x.x.x>`, `cf-ipcountry` = `KR`. 즉 X-Forwarded-For 는 첫 값도(위조 가능) 마지막 값도(Render 내부 IP) 쓸 수 없다.
- `/admin` 의 "내 접속 진단" 에서 서버가 보는 IP 와 위 헤더를 바로 확인할 수 있다. 거기 IP 가 본인 공인 IP 와 다르면 플랫폼 구성이 바뀐 것이니 `CLIENT_IP_HEADER` 로 헤더를 지정한다 (지정이 없고 Cloudflare 헤더도 없으면 `X-Forwarded-For` 의 마지막 값을 쓴다).
- 해외 차단(`BLOCK_FOREIGN_IPS=1`)은 "확실히 해외" 일 때만 403 이고, 사설 IP·판정 불가는 통과시킨다. 대역표 갱신: `node scripts/gen-kr-ranges.mjs`.
- 확인 방법: 국내에서 `/api/conversations` 를 호출하면 401 `gate_required`, 해외에서는 403 `region_blocked`.

### 비용 보호와 IP 정책

- 모두에게: 마지막 메시지 8,000자, 인라인 첨부 2MB(텍스트는 200KB), 웹 검색 답변당 6회.
- **처음 보는 IP** 에만: 분당 메시지 10회, 전송 히스토리 4만 자, 메시지당 첨부 4개.
- 신뢰 판정(`src/lib/ipPolicy.ts`): 정책 도입(2026-11-06 KST) 전에 접속 기록이 있던 IP, 또는 접속이 5회 이상 쌓인 IP 는 제한이 없다. `/admin` 에서 특정 IP 를 **제한 IP** 로 등록하면 항상 제한된다. 허용 목록은 일부러 두지 않는다.
- 접속 코드 입력과 관리자 로그인은 IP 당 분당 10회.

## 관리자 (`/admin`)

누적 통계(삭제와 무관), 현재 저장 상태, 모델별 사용량, 최근 7일, 접속 IP 기록(정책 배지와
제한 버튼), Claude 로 보낼 최근 메시지 수 설정. 비밀번호를 잊으면 Render 대시보드의
`ADMIN_PASSWORD` 값을 확인한다.

## 첨부 파일

- 2MB 이하: base64 로 요청에 인라인. DB 에는 이름·형식만 저장되므로 **새로고침 후에는 모델 문맥에서 빠진다** (화면에 "이전 첨부" 로 표시).
- 2MB 초과: 브라우저 → Vercel Blob(`/api/blob` 토큰) → `/api/files` → Anthropic Files API. `file_id` 가 저장돼 새로고침 후에도 문맥이 유지된다. GPT 모델은 이 첨부를 읽지 못한다.
- 대화를 삭제하면 참조 파일도 지우고, 나머지는 정기 정리가 처리한다.

## 이미지·영상 페이지

`/image`, `/video` 는 Spark 서버(Tailscale Funnel HTTPS)를 브라우저가 직접 호출한다.
Render 를 거치지 않는 것은 의도이며(무료 플랜 대역폭·메모리, 프롬프트·키가 서버에 남지 않음),
서버 프록시를 만들지 말 것. Spark 는 등록된 Origin(운영 사이트) 하나만 받으므로 로컬에서는
403 이 정상이고, 실제 확인은 운영 사이트에서만 할 수 있다. 자세한 접속 조건은
`src/lib/mediaApi.ts` 상단 주석.

## 코드 안내

| 경로 | 역할 |
| --- | --- |
| `src/proxy.ts` | 미들웨어: 해외 차단 → 관리자 쿠키 → 게이트 쿠키 |
| `src/app/api/chat/route.ts` | 채팅 스트림. 제한 정책, 히스토리 절단, 저장(after) |
| `src/lib/ai/claude.ts`, `openai.ts` | 모델 호출. 사고 요약·출처·한도 안내를 평문 스트림에 섞는다 (`streamMarkers.ts`) |
| `src/lib/ai/models.ts` | 모델 목록과 사고 깊이 — 클라이언트와 서버가 공유 |
| `src/lib/ipPolicy.ts`, `rateLimit.ts` | IP 신뢰 판정, 요청 횟수 제한 |
| `src/lib/signedToken.ts` | 게이트·관리자 쿠키 서명 |
| `src/app/ChatClient.tsx` + `src/app/chat/*` | 채팅 화면 |
| `src/app/(media)/*` | 이미지·영상 화면 |
