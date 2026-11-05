import type { NextConfig } from "next";

// 모든 응답에 붙는 기본 보안 헤더.
// - nosniff: 업로드·응답을 브라우저가 다른 형식으로 추측 실행하지 않게
// - Referrer-Policy: 다른 사이트로 나갈 때 경로(대화 id 등)를 흘리지 않게
// - X-Frame-Options: 다른 사이트의 iframe 에 끼워 넣는 클릭재킹 방지
// - Permissions-Policy: 쓰지 않는 기기 권한 차단
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    // Next 16.1부터 개발용 Turbopack 디스크 캐시가 기본 활성화돼 .next/dev 가
    // 세션을 거듭할수록 수백 MB까지 자란다. 이 앱은 작아 캐시 이득이 미미하므로
    // 꺼서 폴더 비대화를 막는다. (끄면 dev 첫 컴파일만 조금 느려짐)
    turbopackFileSystemCacheForDev: false,
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // 이미지·영상 페이지는 어떤 캐시에도 남기지 않는다 (Spark 인수인계 문서 요구).
      // 동적 렌더링이라 운영에선 원래 no-store 가 붙지만, 기본값에 기대지 않고 명시한다.
      ...["/image", "/video"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "no-store" }],
      })),
    ];
  },
};

export default nextConfig;
