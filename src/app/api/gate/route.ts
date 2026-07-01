import { NextResponse } from "next/server";
import {
  GATE_COOKIE,
  GATE_TTL_SECONDS,
  checkAccessCode,
  createGateToken,
} from "@/lib/gateAuth";

// 접속 코드 확인 → 통과 시 서명 쿠키 발급. (proxy 미들웨어에서 이 쿠키를 검문)
export async function POST(req: Request): Promise<Response> {
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
