import { classifyIp, isGeoBlockEnabled } from "@/lib/geo";
import { clientIp } from "@/lib/usage";

// 보호됨(proxy). 접속 IP 진단 — 이 요청을 서버가 어떤 IP 로 보는지, 어느 헤더에서
// 읽었는지 돌려준다. 플랫폼(Render/Cloudflare)이 헤더 구성을 바꾸면 해외 차단과
// IP 정책이 조용히 어긋날 수 있어, /admin 에서 눈으로 확인할 수 있게 둔다.
const HEADER_NAMES = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "cf-ray",
  "cf-ipcountry",
  "x-render-origin-server",
];

export async function GET(req: Request): Promise<Response> {
  const headers: Record<string, string | null> = {};
  for (const n of HEADER_NAMES) headers[n] = req.headers.get(n);
  const ip = clientIp(req);
  return Response.json({
    ip,
    country: classifyIp(ip),
    geoBlockEnabled: isGeoBlockEnabled(),
    customHeader: process.env.CLIENT_IP_HEADER?.trim() || null,
    headers,
  });
}
