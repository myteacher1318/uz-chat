// 프로세스 메모리 기반 요청 횟수 제한.
// Render(상시 단일 프로세스)에서 유효하고, 서버리스/다중 인스턴스에서는
// 인스턴스별 best-effort 로만 동작한다.

export type RateLimiter = {
  /** 이 키의 요청을 1회 기록하고, 창(window) 안의 한도를 넘었는지 돌려준다. */
  hit: (key: string) => boolean;
};

export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
}): RateLimiter {
  const { windowMs, max } = opts;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    hit(key: string): boolean {
      const now = Date.now();
      // 맵이 커지면 만료 항목 정리 (장시간 운영 시 메모리 누수 방지)
      if (buckets.size > 1000) {
        for (const [k, v] of buckets) {
          if (v.resetAt <= now) buckets.delete(k);
        }
      }
      const cur = buckets.get(key);
      if (!cur || cur.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      cur.count += 1;
      return cur.count > max;
    },
  };
}
