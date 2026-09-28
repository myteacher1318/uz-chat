import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next 16.1부터 개발용 Turbopack 디스크 캐시가 기본 활성화돼 .next/dev 가
    // 세션을 거듭할수록 수백 MB까지 자란다. 이 앱은 작아 캐시 이득이 미미하므로
    // 꺼서 폴더 비대화를 막는다. (끄면 dev 첫 컴파일만 조금 느려짐)
    turbopackFileSystemCacheForDev: false,
  },
  // 이미지·영상 페이지는 어떤 캐시에도 남기지 않는다 (Spark 인수인계 문서 요구).
  // 동적 렌더링이라 운영에선 원래 no-store 가 붙지만, 기본값에 기대지 않고 명시한다.
  async headers() {
    return ["/image", "/video"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "no-store" }],
    }));
  },
};

export default nextConfig;
