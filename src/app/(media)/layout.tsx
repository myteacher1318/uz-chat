import { cookies } from "next/headers";
import { GATE_COOKIE, isGateEnabled, verifyGateToken } from "@/lib/gateAuth";
import Gate from "../Gate";
import MediaShell from "./MediaShell";

// 게이트 쿠키를 읽으므로 항상 동적 렌더링 — 응답에 Cache-Control: no-store 가 붙는다
// (인수인계 문서: 페이지 HTML 을 캐시하지 않을 것).
export const dynamic = "force-dynamic";

// /image, /video 공통 레이아웃. 채팅과 같은 접속 코드 게이트를 거친다.
// 레이아웃이 두 페이지에 걸쳐 유지되므로, 이미지↔영상을 오가도 관리자 키와 진행 중인
// 작업이 남아 있다.
export default async function MediaLayout({ children }: { children: React.ReactNode }) {
  if (isGateEnabled()) {
    const store = await cookies();
    const ok = await verifyGateToken(store.get(GATE_COOKIE)?.value);
    if (!ok) return <Gate />;
  }
  return <MediaShell>{children}</MediaShell>;
}
