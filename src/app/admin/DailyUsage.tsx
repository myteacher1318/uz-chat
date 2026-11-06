"use client";

import { useEffect, useState } from "react";
import {
  PolicyBadge,
  StatCard,
  compactNumber,
  formatDateTime,
  nf,
  readError,
  smallBtnClass,
  type IpPolicy,
} from "./ui";

// 일별·IP 별 사용량 — /api/admin/usage 를 기간(7·30·90일)과 IP 로 잘라 읽는다.
// 차트는 라이브러리 없이 HTML/CSS 로 그린다(번들 추가 없음):
//   - 토큰은 입력/출력을 쌓은 세로 막대. 응답 수는 단위가 달라 같은 축에 겹치지 않고
//     아래 작은 차트로 따로 둔다 (이중 축 금지).
//   - 막대 폭 최대 24px, 데이터 끝만 4px 둥글게, 막대·구간 사이 2px 빈틈, 격자는 1px 실선.
//   - 마우스/키보드 포커스로 그 날의 모든 값을 보여주는 툴팁. 툴팁 없이도 "일별 표" 로
//     같은 값을 읽을 수 있다.
// 필터는 한 줄에 두고, 아래 숫자·차트·표가 모두 같은 범위를 본다.

type Days = 7 | 30 | 90;
const DAY_OPTIONS: Days[] = [7, 30, 90];

type Bucket = { messages: number; inputTokens: number; outputTokens: number };
type DailyRow = Bucket & { date: string };
type IpRow = Bucket & { ip: string | null; lastAt: string | null };
type UsageData = {
  days: number;
  ip: string | null;
  ipAvailable: boolean;
  truncated: boolean;
  totals: Bucket;
  daily: DailyRow[];
  byIp: IpRow[];
};

type Series = { key: keyof Bucket; label: string; className: string };
// 계열색은 globals.css 의 --viz-1/--viz-2 (라이트·다크 서피스에서 검증된 파랑·주황).
// 색은 항상 같은 값(입력=파랑, 출력=주황)에 붙는다 — 필터를 바꿔도 바뀌지 않는다.
const TOKEN_SERIES: Series[] = [
  { key: "inputTokens", label: "입력 토큰", className: "bg-viz-1" },
  { key: "outputTokens", label: "출력 토큰", className: "bg-viz-2" },
];
// 응답 수는 한 계열뿐이라 범례 없이 중립색으로
const MESSAGE_SERIES: Series[] = [
  { key: "messages", label: "응답", className: "bg-foreground/70" },
];

type Chart = "tokens" | "messages";
type Hover = { index: number; chart: Chart } | null;

export default function DailyUsage({
  policies,
  reloadTick,
}: {
  policies: Record<string, IpPolicy>; // 접속 IP 기록 표와 같은 판정 (배지용)
  reloadTick: number; // 부모의 "새로고침" 과 함께 다시 읽는다
}) {
  const [days, setDays] = useState<Days>(30);
  const [ip, setIp] = useState<string | null>(null);
  const [showIpTable, setShowIpTable] = useState(false);
  const [showDailyTable, setShowDailyTable] = useState(false);
  const [hover, setHover] = useState<Hover>(null);

  // 요청 키 — 응답이 이 키와 맞을 때만 "불러옴" 상태. 늦게 도착한 옛 응답은 무시하고,
  // 다시 읽는 동안에는 이전 차트를 흐리게 남겨 둔다 (레이아웃이 튀지 않게).
  const key = `${days}|${ip ?? ""}|${reloadTick}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    data: UsageData | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = loaded?.data ?? null;
  const loading = loaded?.key !== key;

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const q = new URLSearchParams({ days: String(days) });
        if (ip) q.set("ip", ip);
        const res = await fetch(`/api/admin/usage?${q.toString()}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(await readError(res, "사용량을 불러오지 못했습니다."));
        }
        const d = (await res.json()) as UsageData;
        if (ctrl.signal.aborted) return;
        setLoaded({ key, data: d });
        setError(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "사용량을 불러오지 못했습니다.");
        setLoaded((prev) => ({ key, data: prev?.data ?? null }));
      }
    })();
    return () => ctrl.abort();
  }, [days, ip, key]);

  // IP 선택 목록 — 기간 안에 기록이 있는 IP. 지금 고른 IP 가 새 기간에 없어도 목록에 남긴다.
  const ipOptions = data
    ? data.byIp.map((r) => r.ip).filter((x): x is string => !!x)
    : [];
  const options =
    ip && !ipOptions.includes(ip) ? [...ipOptions, ip] : ipOptions;
  const scope = `최근 ${days}일 · ${ip ?? "전체 IP"}`;

  return (
    <section className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">일별 사용량</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {scope} · 한국 시간 기준 · 대화를 삭제해도 유지
        </span>
      </div>

      {/* 필터 한 줄 — 아래 숫자·차트·표가 모두 이 범위를 본다 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="기간"
          className="flex overflow-hidden rounded-lg border border-black/[.1] text-xs dark:border-white/[.15]"
        >
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 transition-colors ${
                days === d
                  ? "bg-foreground font-medium text-background"
                  : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
        <select
          aria-label="IP 선택"
          value={ip ?? ""}
          onChange={(e) => setIp(e.target.value || null)}
          disabled={data ? !data.ipAvailable : false}
          className="rounded-lg border border-black/[.1] bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:border-black/30 disabled:opacity-40 dark:border-white/[.15] dark:focus:border-white/40"
        >
          <option value="">전체 IP</option>
          {options.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={showIpTable}
            onChange={(e) => setShowIpTable(e.target.checked)}
          />
          IP별 사용량 표
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={showDailyTable}
            onChange={(e) => setShowDailyTable(e.target.checked)}
          />
          일별 표
        </label>
      </div>

      {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
      {data && !data.ipAvailable && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[.08] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          원장에 IP 열이 없어 IP 별 집계를 할 수 없습니다. Supabase SQL Editor 에서{" "}
          <code>db/usage_tracking.sql</code> 을 다시 실행하세요.
        </p>
      )}
      {data?.truncated && (
        <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
          * 원장이 너무 커서 일부만 집계했습니다.
        </p>
      )}

      {!data ? (
        <p className="text-xs text-zinc-500">
          {loading ? "불러오는 중…" : "데이터 없음"}
        </p>
      ) : (
        <div
          className={`flex flex-col gap-5 transition-opacity ${loading ? "opacity-50" : ""}`}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="응답 수" value={nf(data.totals.messages)} />
            <StatCard label="입력 토큰" value={nf(data.totals.inputTokens)} />
            <StatCard label="출력 토큰" value={nf(data.totals.outputTokens)} />
            <StatCard
              label="총 토큰"
              value={nf(data.totals.inputTokens + data.totals.outputTokens)}
            />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium">토큰</h3>
              <div className="flex gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                {TOKEN_SERIES.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-sm ${s.className}`}
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
            <Columns
              chart="tokens"
              rows={data.daily}
              series={TOKEN_SERIES}
              height={160}
              tipAnchor="top"
              hover={hover}
              onHover={setHover}
            />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium">응답 수</h3>
            <Columns
              chart="messages"
              rows={data.daily}
              series={MESSAGE_SERIES}
              height={72}
              tipAnchor="bottom"
              hover={hover}
              onHover={setHover}
            />
          </div>

          {showDailyTable && <DailyTable rows={data.daily} />}
          {showIpTable && (
            <IpTable
              rows={data.byIp}
              policies={policies}
              selected={ip}
              onSelect={setIp}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ── 세로 막대 차트 (HTML/CSS) ────────────────────────────────
// 한 칸(slot) 이 하루. 칸 전체가 마우스·포커스 대상이라 가는 막대를 정확히 짚지 않아도 된다.
function Columns({
  chart,
  rows,
  series,
  height,
  tipAnchor,
  hover,
  onHover,
}: {
  chart: Chart;
  rows: DailyRow[];
  series: Series[];
  height: number; // 플롯 높이(px). x 축 라벨 띠는 아래에 따로 더한다
  // 툴팁 세로 기준 — 높은 플롯은 위쪽에 맞춰 플롯 안에, 낮은 플롯은 바닥에 맞춰 위로 자라게
  tipAnchor: "top" | "bottom";
  hover: Hover;
  onHover: (h: Hover) => void;
}) {
  const sums = rows.map((r) => series.reduce((s, x) => s + r[x.key], 0));
  const max = Math.max(0, ...sums);
  const { top, ticks } = niceScale(max);
  // 축 안에서는 한 가지 서식만: 최댓값이 1만을 넘을 때만 K/M 로 줄인다
  const yFormat = top >= 10_000 ? compactNumber : nf;
  const n = rows.length;
  const labelEvery = n <= 7 ? 1 : n <= 30 ? 5 : 15;

  return (
    <div className="pl-11">
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute inset-x-0 border-t border-line"
            style={{ bottom: `${(t / top) * 100}%` }}
          >
            <span className="absolute top-0 right-full -translate-y-1/2 pr-2 text-[10px] tabular-nums text-muted">
              {yFormat(t)}
            </span>
          </div>
        ))}
        {max === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-muted">
            기간 내 기록 없음
          </p>
        )}
        <div className="absolute inset-0 flex items-stretch gap-[2px]">
          {rows.map((r, i) => {
            const hovered = hover?.index === i;
            const segs = series
              .map((s) => ({ ...s, value: r[s.key] }))
              .filter((s) => s.value > 0);
            const readout = `${dateLabel(r.date)}: ${series
              .map((s) => `${s.label} ${nf(r[s.key])}`)
              .join(", ")}`;
            // 툴팁은 짚은 막대를 가리지 않게 옆에, 플롯 가운데 쪽으로 붙인다
            // (가장자리 칸이어도 카드 밖으로 나가지 않는다)
            const side = `${i < n / 2 ? "left-full ml-1.5" : "right-full mr-1.5"} ${
              tipAnchor === "top" ? "top-0" : "bottom-0"
            }`;
            return (
              <div
                key={r.date}
                role="img"
                tabIndex={0}
                aria-label={readout}
                className={`relative flex flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-foreground/40 ${
                  hovered ? "bg-foreground/[.04]" : ""
                }`}
                onPointerEnter={() => onHover({ index: i, chart })}
                onPointerLeave={() => onHover(null)}
                onFocus={() => onHover({ index: i, chart })}
                onBlur={() => onHover(null)}
              >
                <div className="flex h-full w-full max-w-6 flex-col-reverse justify-start gap-[2px]">
                  {segs.map((s, j) => (
                    <div
                      key={s.key}
                      className={`${s.className} ${
                        j === segs.length - 1 ? "rounded-t" : ""
                      } ${hovered ? "brightness-110" : ""}`}
                      style={{ height: `${(s.value / top) * 100}%` }}
                    />
                  ))}
                </div>
                {hovered && hover?.chart === chart && (
                  <Tooltip row={r} side={side} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex h-4 gap-[2px]">
        {rows.map((r, i) => (
          <div key={r.date} className="relative flex-1">
            {i % labelEvery === 0 && (
              <span className="absolute left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap tabular-nums text-muted">
                {r.date.slice(5).replace("-", "/")}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// 하루치 툴팁 — 어느 차트 위에 있든 그 날의 값을 전부 보여준다 (값이 앞, 이름이 뒤)
function Tooltip({ row, side }: { row: DailyRow; side: string }) {
  return (
    <div
      role="tooltip"
      className={`pointer-events-none absolute z-10 w-max rounded-lg border border-line bg-raised px-2.5 py-2 text-xs shadow-md ${side}`}
    >
      <div className="mb-1 font-medium">{dateLabel(row.date)}</div>
      <TipRow value={row.messages} label="응답" swatch="bg-foreground/70" />
      <TipRow value={row.inputTokens} label="입력 토큰" swatch="bg-viz-1" />
      <TipRow value={row.outputTokens} label="출력 토큰" swatch="bg-viz-2" />
      <TipRow value={row.inputTokens + row.outputTokens} label="총 토큰" />
    </div>
  );
}

function TipRow({
  value,
  label,
  swatch,
}: {
  value: number;
  label: string;
  swatch?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-[2px] w-3 ${swatch ?? ""}`} />
      <b className="w-16 text-right tabular-nums">{nf(value)}</b>
      <span className="text-muted">{label}</span>
    </div>
  );
}

// 깔끔한 눈금: 1·2·5 × 10^n 간격으로 4칸 안팎. 값이 모두 정수라 간격도 1 이상.
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0] };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const step = Math.max(
    1,
    Math.round((f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow),
  );
  const count = Math.max(1, Math.ceil(max / step - 1e-9));
  return {
    top: count * step,
    ticks: Array.from({ length: count + 1 }, (_, i) => i * step),
  };
}

// "2026-11-06 (금)" — 날짜 키는 서버가 KST 로 잘라 준 것
function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return date;
  const wd = d.toLocaleDateString("ko-KR", {
    weekday: "short",
    timeZone: "Asia/Seoul",
  });
  return `${date} (${wd})`;
}

// ── 표 (툴팁 없이도 같은 값을 읽을 수 있게) ─────────────────
const th = "pb-1 text-right font-medium";
const thLeft = "pb-1 pr-4 text-left font-medium";
const td = "py-1.5 text-right tabular-nums";
const tr = "border-b border-black/[.05] last:border-0 dark:border-white/[.08]";

function DailyTable({ rows }: { rows: DailyRow[] }) {
  const active = [...rows].reverse().filter((r) => r.messages > 0);
  return (
    <div className="overflow-x-auto">
      <h3 className="mb-2 text-xs font-medium">일별 표 (기록이 있는 날만)</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-zinc-500 dark:text-zinc-400">
            <th className={thLeft}>날짜</th>
            <th className={th}>응답</th>
            <th className={th}>입력</th>
            <th className={th}>출력</th>
            <th className={th}>합계</th>
          </tr>
        </thead>
        <tbody>
          {active.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-2 text-xs text-zinc-500">
                기간 내 기록 없음
              </td>
            </tr>
          ) : (
            active.map((r) => (
              <tr key={r.date} className={tr}>
                <td className="py-1.5 pr-4 font-mono text-xs">{dateLabel(r.date)}</td>
                <td className={td}>{nf(r.messages)}</td>
                <td className={`${td} text-zinc-500`}>{nf(r.inputTokens)}</td>
                <td className={`${td} text-zinc-500`}>{nf(r.outputTokens)}</td>
                <td className={td}>{nf(r.inputTokens + r.outputTokens)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function IpTable({
  rows,
  policies,
  selected,
  onSelect,
}: {
  rows: IpRow[];
  policies: Record<string, IpPolicy>;
  selected: string | null;
  onSelect: (ip: string | null) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <h3 className="mb-2 text-xs font-medium">IP별 사용량 (기간 전체 기준)</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-zinc-500 dark:text-zinc-400">
            <th className={thLeft}>IP</th>
            <th className={thLeft}>정책</th>
            <th className={th}>응답</th>
            <th className={th}>입력</th>
            <th className={th}>출력</th>
            <th className={th}>합계</th>
            <th className="pb-1 pl-4 text-left font-medium">최근 사용</th>
            <th className="pb-1"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-2 text-xs text-zinc-500">
                기간 내 기록 없음
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const ipValue = r.ip;
              const policy = ipValue ? policies[ipValue] : undefined;
              const isSelected = ipValue !== null && ipValue === selected;
              return (
                <tr
                  key={ipValue ?? "(none)"}
                  className={`${tr} ${isSelected ? "bg-foreground/[.04]" : ""}`}
                >
                  <td className="py-1.5 pr-4 font-mono text-xs">
                    {ipValue ?? (
                      <span
                        className="font-sans text-zinc-500"
                        title="IP 열이 생기기(2026-11-06) 전의 기록"
                      >
                        IP 미기록
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4">
                    {policy ? (
                      <PolicyBadge policy={policy} />
                    ) : (
                      <span className="text-xs text-zinc-500">—</span>
                    )}
                  </td>
                  <td className={td}>{nf(r.messages)}</td>
                  <td className={`${td} text-zinc-500`}>{nf(r.inputTokens)}</td>
                  <td className={`${td} text-zinc-500`}>{nf(r.outputTokens)}</td>
                  <td className={td}>{nf(r.inputTokens + r.outputTokens)}</td>
                  <td className="py-1.5 pl-4 text-xs text-zinc-500">
                    {formatDateTime(r.lastAt)}
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    {ipValue &&
                      (isSelected ? (
                        <button
                          type="button"
                          onClick={() => onSelect(null)}
                          className={smallBtnClass}
                        >
                          전체로
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelect(ipValue)}
                          title="위 차트를 이 IP 만으로 그립니다"
                          className={smallBtnClass}
                        >
                          차트
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-zinc-500">
        정책 배지는 접속 IP 기록과 같은 판정입니다. 배지가 없으면 접속 기록 표(최근 200개)에
        없는 IP 입니다.
      </p>
    </div>
  );
}
