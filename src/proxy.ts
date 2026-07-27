import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyToken } from "@/lib/adminAuth";
import { GATE_COOKIE, isGateEnabled, verifyGateToken } from "@/lib/gateAuth";
import { isForeignIp, isGeoBlockEnabled } from "@/lib/geo";
import { clientIp } from "@/lib/usage";

// 서버에서 실제 차단(UI 숨김이 아님).
// - 해외 IP     : BLOCK_FOREIGN_IPS 설정 시 국내 대역 외 접근을 막는다 (가장 먼저)
// - /api/admin/*: 관리자 쿠키 필요 (로그인/로그아웃은 예외)
// - /api/gate   : 코드 제출 경로라 게이트 쿠키 검사는 안 하지만, 해외 차단은 적용된다
// - 그 외 API   : 접속 코드(게이트) 쿠키 필요 (ACCESS_CODE 설정 시에만)
// (Next 16: 'middleware' 컨벤션이 'proxy'로 변경됨)
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 0) 해외 IP 차단 — 저장소에 커밋된 한국 IP 대역표로 판정한다(외부 API 없음).
  //    "확실히 해외"일 때만 막는다. 사설 IP·IPv6 파싱 실패 등 판정 불가는 통과시킨다.
  //    (판정 불가까지 막으면 한국 모바일 IPv6 사용자나 내부 트래픽이 함께 끊긴다)
  //    VPN으로 우회 가능하므로 게이트 코드를 대체하는 수단이 아니라 보조 방어선이다.
  if (isGeoBlockEnabled() && isForeignIp(clientIp(req))) {
    return NextResponse.json({ error: "region_blocked" }, { status: 403 });
  }

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

  // 2) 게이트 코드 제출 경로 — 아직 쿠키가 없는 게 정상이므로 게이트 검사 대상이 아니다.
  //    (위의 해외 차단은 이미 통과했으므로, 해외에서의 코드 무차별 대입은 막힌다)
  if (pathname === "/api/gate") {
    return NextResponse.next();
  }

  // 3) 채팅 관련 API — 접속 코드 게이트 (미설정 시 무검문)
  if (isGateEnabled()) {
    const token = req.cookies.get(GATE_COOKIE)?.value;
    if (!(await verifyGateToken(token))) {
      return NextResponse.json({ error: "gate_required" }, { status: 401 });
    }
  }
  return NextResponse.next();
}

export const config = {
  // 페이지 경로('/')는 일부러 제외한다 — render.yaml 의 healthCheckPath 가 '/' 라서
  // 여기에 차단이 걸리면 Render 헬스체크가 실패해 서비스가 unhealthy 로 판정된다.
  // API를 전부 막으면 차단 효과는 동일하다(페이지는 열리되 아무 기능도 동작하지 않음).
  // /api/cleanup 은 크론용이라 제외 (CRON_SECRET 으로 별도 보호 · 해외에서 호출될 수 있음).
  matcher: [
    "/api/admin/:path*",
    "/api/gate",
    "/api/chat",
    "/api/conversations",
    "/api/messages",
    "/api/files",
    "/api/blob",
  ],
};
