import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyToken } from "@/lib/adminAuth";
import { GATE_COOKIE, isGateEnabled, verifyGateToken } from "@/lib/gateAuth";

// 서버에서 실제 차단(UI 숨김이 아님).
// - /api/admin/* : 관리자 쿠키 필요 (로그인/로그아웃은 예외)
// - 채팅 관련 API : 접속 코드(게이트) 쿠키 필요 (ACCESS_CODE 설정 시에만)
// (Next 16: 'middleware' 컨벤션이 'proxy'로 변경됨)
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) 관리자 API 보호
  if (pathname.startsWith("/api/admin")) {
    if (pathname === "/api/admin/login" || pathname === "/api/admin/logout") {
      return NextResponse.next();
    }
    const token = req.cookies.get(ADMIN_COOKIE)?.value;
    if (!(await verifyToken(token))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // 2) 채팅 관련 API — 접속 코드 게이트 (미설정 시 무검문)
  if (isGateEnabled()) {
    const token = req.cookies.get(GATE_COOKIE)?.value;
    if (!(await verifyGateToken(token))) {
      return NextResponse.json({ error: "gate_required" }, { status: 401 });
    }
  }
  return NextResponse.next();
}

export const config = {
  // /api/gate(코드 확인)와 /api/cleanup(크론·CRON_SECRET로 별도 보호)은 제외.
  matcher: [
    "/api/admin/:path*",
    "/api/chat",
    "/api/conversations",
    "/api/messages",
    "/api/files",
    "/api/blob",
  ],
};
