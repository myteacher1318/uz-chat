// /admin 화면 공통 — 서식 함수, 정책 배지, 버튼 스타일, 통계 카드.
// AdminClient(요약·설정·접속 기록) 와 DailyUsage(일별·IP 별 사용량) 가 함께 쓴다.

export type IpPolicy = "trusted" | "limited" | "restricted";

export const nf = (n: number) => (n ?? 0).toLocaleString("ko-KR");

export function formatBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDateTime(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ko-KR");
}

// 차트 축 눈금용 — 천 단위부터 K/M 로 줄인다. (한 축 안에서는 한 가지 서식만 쓴다:
// 축의 최댓값이 1만 이상일 때만 이 함수를 쓰고, 아니면 nf 로 전부 그대로 적는다)
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${trimZero((n / 1_000).toFixed(1))}K`;
  return nf(n);
}
const trimZero = (s: string) => s.replace(/\.0$/, "");

export const POLICY_LABEL: Record<IpPolicy, { text: string; className: string }> = {
  trusted: {
    text: "신뢰",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  limited: {
    text: "제한 중",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  restricted: {
    text: "제한 IP",
    className: "bg-red-500/10 text-red-500",
  },
};

export function PolicyBadge({ policy }: { policy: IpPolicy }) {
  const p = POLICY_LABEL[policy] ?? POLICY_LABEL.limited;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${p.className}`}
    >
      {p.text}
    </span>
  );
}

export const btnClass =
  "rounded-lg border border-black/[.1] px-3 py-1.5 text-sm transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:hover:bg-white/[.06]";
export const smallBtnClass =
  "rounded-md border border-black/[.1] px-2 py-0.5 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:hover:bg-white/[.06]";

export async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const d = await res.json();
    if (typeof d?.error === "string") return d.error;
  } catch {
    /* 본문이 JSON 이 아님 */
  }
  return fallback;
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
