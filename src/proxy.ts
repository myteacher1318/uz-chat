import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyToken } from "@/lib/adminAuth";

// /api/admin/* 를 서버에서 실제 차단(UI 숨김이 아님).
// 로그인/로그아웃은 인증 없이 접근 가능해야 하므로 예외.
// (Next 16: 'middleware' 컨벤션이 'proxy'로 변경됨)
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/admin/login" || pathname === "/api/admin/logout") {
    return NextResponse.next();
  }

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!(await verifyToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
