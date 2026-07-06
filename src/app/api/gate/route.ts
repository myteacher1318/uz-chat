import { NextResponse } from "next/server";
import {
  GATE_COOKIE,
  GATE_TTL_SECONDS,
  checkAccessCode,
  createGateToken,
} from "@/lib/gateAuth";
import { clientIp } from "@/lib/usage";

// 무차별 대입 방지 — IP당 1분에 10회까지만 시도 허용.
// 프로세스 메모리 기준: Render(상시 단일 프로세스)에서 유효하고,
// 서버리스에서는 인스턴스별 best-effort 로 동작한다.
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  // 맵이 커지면 만료 항목 정리 (장시간 운영 시 메모리 누수 방지)
  if (attempts.size > 1000) {
    for (const [k, v] of attempts) {
      if (v.resetAt <= now) attempts.delete(k);
    }
  }
  const cur = attempts.get(ip);
  if (!cur || cur.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > MAX_ATTEMPTS_PER_WINDOW;
}

// 접속 코드 확인 → 통과 시 서명 쿠키 발급. (proxy 미들웨어에서 이 쿠키를 검문)
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req) ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "시도가 너무 많습니다. 잠시 후 다시 시도하세요." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const code = (body as { code?: unknown } | null)?.code;

  if (!(await checkAccessCode(code))) {
    return NextResponse.json(
      { error: "코드가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  const token = await createGateToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // localhost(http) 테스트 허용
    sameSite: "lax",
    path: "/",
    maxAge: GATE_TTL_SECONDS,
  });
  return res;
}
