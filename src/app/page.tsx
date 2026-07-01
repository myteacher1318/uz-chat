import { cookies } from "next/headers";
import { GATE_COOKIE, isGateEnabled, verifyGateToken } from "@/lib/gateAuth";
import ChatClient from "./ChatClient";
import Gate from "./Gate";

// 게이트 쿠키를 읽으므로 항상 동적 렌더링
export const dynamic = "force-dynamic";

export default async function Home() {
  // ACCESS_CODE 가 설정돼 있으면, 유효한 게이트 쿠키가 없을 때 대문 화면을 보여준다.
  if (isGateEnabled()) {
    const store = await cookies();
    const ok = await verifyGateToken(store.get(GATE_COOKIE)?.value);
    if (!ok) return <Gate />;
  }
  return <ChatClient />;
}
