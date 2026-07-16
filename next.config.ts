import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next 16.1부터 개발용 Turbopack 디스크 캐시가 기본 활성화돼 .next/dev 가
    // 세션을 거듭할수록 수백 MB까지 자란다. 이 앱은 작아 캐시 이득이 미미하므로
    // 꺼서 폴더 비대화를 막는다. (끄면 dev 첫 컴파일만 조금 느려짐)
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
