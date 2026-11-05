import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_TTL_SECONDS,
  checkPassword,
  createToken,
} from "@/lib/adminAuth";
import { createRateLimiter } from "@/lib/rateLimit";
import { clientIp } from "@/lib/usage";

// 비밀번호 무차별 대입 방지 — IP당 1분에 10회. (실제 관리자는 한두 번이면 들어온다)
const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req) ?? "unknown";
  if (limiter.hit(ip)) {
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
  const password = (body as { password?: unknown } | null)?.password;

  if (!(await checkPassword(password))) {
    return NextResponse.json(
      { error: "비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  const token = await createToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true, // 브라우저 JS에서 못 읽음
    secure: process.env.NODE_ENV === "production", // 프로덕션(HTTPS)에서만 secure (localhost http 테스트 위해)
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_TTL_SECONDS,
  });
  return res;
}
