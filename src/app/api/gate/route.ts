import { NextResponse } from "next/server";
import {
  GATE_COOKIE,
  GATE_TTL_SECONDS,
  checkAccessCode,
  createGateToken,
  isGateMisconfigured,
} from "@/lib/gateAuth";
import { createRateLimiter } from "@/lib/rateLimit";
import { clientIp } from "@/lib/usage";

// 무차별 대입 방지 — IP당 1분에 10회까지만 시도 허용.
const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

// 접속 코드 확인 → 통과 시 서명 쿠키 발급. (proxy 미들웨어에서 이 쿠키를 검문)
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req) ?? "unknown";
  if (limiter.hit(ip)) {
    return NextResponse.json(
      { error: "시도가 너무 많습니다. 잠시 후 다시 시도하세요." },
      { status: 429 },
    );
  }

  if (isGateMisconfigured()) {
    return NextResponse.json(
      { error: "접속 코드가 설정되지 않아 입장할 수 없습니다. 관리자에게 문의하세요." },
      { status: 503 },
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
