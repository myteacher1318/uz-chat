"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type IpPolicy = "trusted" | "limited" | "restricted";

type Stats = {
  cumulative: {
    conversations: number;
    userMessages: number;
    assistantMessages: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    attachmentCount: number;
    attachmentBytes: number;
  };
  live: {
    conversations: number;
    messages: number;
    filesApi: { available: boolean; count: number; bytes: number };
  };
  byModel: {
    model: string;
    count: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  ledgerTruncated?: boolean;
  last7Days: { date: string; messages: number; tokens: number }[];
  access: {
    total: number;
    rows: {
      ip: string;
      hits: number;
      firstSeen: string | null;
      lastSeen: string | null;
      userAgent: string | null;
      policy: IpPolicy;
    }[];
  };
  ipPolicy?: {
    grandfatherBefore: string;
    trustAfterHits: number;
    restrictedAvailable: boolean;
  };
};

type RestrictedRow = { ip: string; note: string | null; created_at: string };

type WhoAmI = {
  ip: string | null;
  country: "kr" | "foreign" | "unknown";
  geoBlockEnabled: boolean;
  customHeader: string | null;
  headers: Record<string, string | null>;
};

const COUNTRY_LABEL: Record<WhoAmI["country"], string> = {
  kr: "국내",
  foreign: "해외 (차단 대상)",
  unknown: "판정 불가 (통과)",
};

const nf = (n: number) => (n ?? 0).toLocaleString("ko-KR");

function formatBytes(n: number): string {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ko-KR");
}

const POLICY_LABEL: Record<IpPolicy, { text: string; className: string }> = {
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

const btnClass =
  "rounded-lg border border-black/[.1] px-3 py-1.5 text-sm transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:hover:bg-white/[.06]";
const smallBtnClass =
  "rounded-md border border-black/[.1] px-2 py-0.5 text-xs transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:hover:bg-white/[.06]";

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const d = await res.json();
    if (typeof d?.error === "string") return d.error;
  } catch {
    /* 본문이 JSON 이 아님 */
  }
  return fallback;
}

export default function AdminClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [limit, setLimit] = useState<string>("");
  const [savedLimit, setSavedLimit] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 제한 IP 목록 — null 이면 아직 못 불러왔거나 테이블이 없다(restrictedError 참고)
  const [restricted, setRestricted] = useState<RestrictedRow[] | null>(null);
  const [restrictedError, setRestrictedError] = useState<string | null>(null);
  const [newIp, setNewIp] = useState("");
  const [newNote, setNewNote] = useState("");
  const [ipBusy, setIpBusy] = useState<string | null>(null); // 처리 중인 IP
  const [ipMsg, setIpMsg] = useState<string | null>(null);
  // 내 접속 진단 — 서버가 이 브라우저를 어떤 IP 로 보는지
  const [whoami, setWhoami] = useState<WhoAmI | null>(null);

  useEffect(() => {
    void load();
    // 최초 1회 로드 — load 는 state setter 만 쓰므로 의존성으로 묶을 필요가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRestricted() {
    try {
      const res = await fetch("/api/admin/ips");
      if (!res.ok) {
        setRestricted(null);
        setRestrictedError(await readError(res, "제한 IP 목록을 불러오지 못했습니다."));
        return;
      }
      const d = (await res.json()) as { rows: RestrictedRow[] };
      setRestricted(d.rows ?? []);
      setRestrictedError(null);
    } catch {
      setRestricted(null);
      setRestrictedError("제한 IP 목록을 불러오지 못했습니다.");
    }
  }

  async function load() {
    setLoadingStats(true);
    setErr(null);
    try {
      const [sRes, cRes, wRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/settings"),
        fetch("/api/admin/whoami"),
        loadRestricted(),
      ]);
      if (wRes.ok) setWhoami(await wRes.json());
      if (sRes.ok) setStats(await sRes.json());
      else setErr("통계를 불러오지 못했습니다.");
      if (cRes.ok) {
        const cfg = await cRes.json();
        setSavedLimit(cfg.message_history_limit);
        setLimit(String(cfg.message_history_limit));
        setUpdatedAt(cfg.updated_at ?? null);
      }
    } catch {
      setErr("데이터를 불러오지 못했습니다.");
    } finally {
      setLoadingStats(false);
    }
  }

  async function saveLimit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageHistoryLimit: Number(limit) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장에 실패했습니다.");
      setSavedLimit(data.message_history_limit);
      setLimit(String(data.message_history_limit));
      setUpdatedAt(data.updated_at ?? null);
      setMsg("저장되었습니다. 다음 메시지부터 즉시 적용됩니다.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // 제한 IP 추가 — 접속 기록 표의 [제한] 버튼과 직접 입력 양쪽에서 쓴다.
  async function restrictIp(ip: string, note: string) {
    const target = ip.trim();
    if (!target) return;
    setIpBusy(target);
    setIpMsg(null);
    try {
      const res = await fetch("/api/admin/ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: target, note }),
      });
      if (!res.ok) throw new Error(await readError(res, "추가하지 못했습니다."));
      setNewIp("");
      setNewNote("");
      setIpMsg(`${target} 을(를) 제한 IP 에 추가했습니다.`);
      await Promise.all([loadRestricted(), refreshStatsQuiet()]);
    } catch (e) {
      setIpMsg(e instanceof Error ? e.message : "추가하지 못했습니다.");
    } finally {
      setIpBusy(null);
    }
  }

  async function unrestrictIp(ip: string) {
    setIpBusy(ip);
    setIpMsg(null);
    try {
      const res = await fetch(`/api/admin/ips?ip=${encodeURIComponent(ip)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res, "해제하지 못했습니다."));
      setIpMsg(`${ip} 의 제한을 해제했습니다. (자동 판정으로 돌아갑니다)`);
      await Promise.all([loadRestricted(), refreshStatsQuiet()]);
    } catch (e) {
      setIpMsg(e instanceof Error ? e.message : "해제하지 못했습니다.");
    } finally {
      setIpBusy(null);
    }
  }

  // 정책 배지만 갱신하려고 통계를 조용히 다시 읽는다 (로딩 표시 없이)
  async function refreshStatsQuiet() {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) setStats(await res.json());
    } catch {
      /* 다음 새로고침 때 반영 */
    }
  }

  async function logout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      window.location.reload();
    }
  }

  const maxDayTokens = stats
    ? Math.max(1, ...stats.last7Days.map((d) => d.tokens))
    : 1;

  const grandfather = stats?.ipPolicy?.grandfatherBefore
    ? new Date(stats.ipPolicy.grandfatherBefore).toLocaleDateString("ko-KR")
    : "정책 도입일";
  const trustAfter = stats?.ipPolicy?.trustAfterHits ?? 5;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">관리자</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className={btnClass}>
            새로고침
          </button>
          <Link href="/" className={btnClass}>
            ← 채팅으로
          </Link>
          <button onClick={() => void logout()} className={btnClass}>
            로그아웃
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}

      {/* 대화 한계 설정 */}
      <section className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
        <h2 className="mb-1 text-sm font-semibold">
          대화 한계 (Claude로 보낼 최근 메시지 수)
        </h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          현재 값: <b>{savedLimit ?? "—"}</b>
          {updatedAt && ` · 수정: ${new Date(updatedAt).toLocaleString("ko-KR")}`}
        </p>
        <form onSubmit={saveLimit} className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-28 rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </form>
        {msg && (
          <p className="mt-2 text-xs text-green-600 dark:text-green-400">{msg}</p>
        )}
      </section>

      {/* 접속 IP 정책 */}
      <section className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
        <h2 className="mb-1 text-sm font-semibold">접속 IP 정책</h2>
        <p className="mb-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          <b>신뢰</b> IP 는 제한이 없습니다 — {grandfather} 이전에 접속 기록이 있던 IP, 그리고
          그 뒤 새로 왔더라도 접속이 {trustAfter}회 이상 쌓인 IP. <b>제한 중</b> 인 처음 보는 IP 는
          분당 메시지 10회·히스토리 4만 자·첨부 4개로 제한됩니다. <b>제한 IP</b> 로 등록하면 접속
          횟수와 무관하게 항상 제한됩니다. (허용 목록은 일부러 두지 않습니다 — 해제하면 자동
          판정으로 돌아갈 뿐입니다)
        </p>

        {restrictedError && (
          <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[.08] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {restrictedError}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void restrictIp(newIp, newNote);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            placeholder="IP 주소"
            aria-label="제한할 IP 주소"
            className="w-48 rounded-lg border border-black/[.1] bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
          />
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="메모 (선택)"
            aria-label="메모"
            className="w-56 rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
          />
          <button
            type="submit"
            disabled={!newIp.trim() || ipBusy !== null || !!restrictedError}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            제한 IP 추가
          </button>
        </form>
        {ipMsg && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{ipMsg}</p>}

        {whoami && (
          <div className="mt-4 rounded-lg border border-black/[.06] bg-black/[.02] p-3 text-xs dark:border-white/[.1] dark:bg-white/[.03]">
            <p className="mb-1 font-medium">
              내 접속 진단 — 서버가 이 브라우저를{" "}
              <span className="font-mono">{whoami.ip ?? "(IP 없음)"}</span> 로 봅니다 ·{" "}
              {COUNTRY_LABEL[whoami.country]} · 해외 차단{" "}
              {whoami.geoBlockEnabled ? "켜짐" : "꺼짐"}
              {whoami.customHeader && ` · CLIENT_IP_HEADER=${whoami.customHeader}`}
            </p>
            <p className="mb-2 text-zinc-500 dark:text-zinc-400">
              여기 IP 가 실제 공인 IP 와 다르면(사설 IP·Cloudflare 주소 등) 해외 차단과 IP
              정책이 어긋난 것입니다. README 의 &quot;접속 IP&quot; 항목을 참고해 CLIENT_IP_HEADER 를
              조정하세요.
            </p>
            <table className="w-full">
              <tbody>
                {Object.entries(whoami.headers).map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-0.5 pr-3 font-mono text-zinc-500">{k}</td>
                    <td className="py-0.5 font-mono break-all">{v ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3">
          {restricted && restricted.length === 0 && (
            <p className="text-xs text-zinc-500">등록된 제한 IP 가 없습니다.</p>
          )}
          {restricted && restricted.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                  <th className="pb-1 pr-4 text-left font-medium">IP</th>
                  <th className="pb-1 pr-4 text-left font-medium">메모</th>
                  <th className="pb-1 pr-4 text-left font-medium">등록</th>
                  <th className="pb-1 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {restricted.map((r) => (
                  <tr
                    key={r.ip}
                    className="border-b border-black/[.05] last:border-0 dark:border-white/[.08]"
                  >
                    <td className="py-1.5 pr-4 font-mono text-xs">{r.ip}</td>
                    <td className="py-1.5 pr-4 text-xs text-zinc-500">{r.note ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-xs text-zinc-500">
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => void unrestrictIp(r.ip)}
                        disabled={ipBusy !== null}
                        className={smallBtnClass}
                      >
                        {ipBusy === r.ip ? "처리 중…" : "해제"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {loadingStats ? (
        <p className="text-sm text-zinc-500">통계 불러오는 중…</p>
      ) : stats ? (
        <>
          {/* 누적 통계 (대화를 삭제해도 보존) */}
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">누적 통계</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                대화를 삭제해도 사라지지 않습니다
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="누적 대화" value={nf(stats.cumulative.conversations)} />
              <StatCard
                label="사용자 메시지"
                value={nf(stats.cumulative.userMessages)}
              />
              <StatCard
                label="어시스턴트 응답"
                value={nf(stats.cumulative.assistantMessages)}
              />
              <StatCard
                label="총 토큰"
                value={nf(stats.cumulative.totalTokens)}
              />
              <StatCard
                label="첨부 수"
                value={nf(stats.cumulative.attachmentCount)}
              />
              <StatCard
                label="첨부 누적 용량"
                value={formatBytes(stats.cumulative.attachmentBytes)}
              />
            </div>
          </section>

          {/* 토큰 사용량 상세 */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="입력 토큰"
              value={nf(stats.cumulative.inputTokens)}
            />
            <StatCard
              label="출력 토큰"
              value={nf(stats.cumulative.outputTokens)}
            />
            <StatCard label="총 토큰" value={nf(stats.cumulative.totalTokens)} />
          </section>

          {/* 현재 저장 상태 (라이브) */}
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">현재 저장 상태</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                지금 DB·스토리지에 남아있는 실제 데이터
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="현재 대화"
                value={nf(stats.live.conversations)}
              />
              <StatCard label="현재 메시지" value={nf(stats.live.messages)} />
              <StatCard
                label="첨부 파일(저장됨)"
                value={
                  stats.live.filesApi.available
                    ? nf(stats.live.filesApi.count)
                    : "N/A"
                }
              />
              <StatCard
                label="첨부 저장 용량"
                value={
                  stats.live.filesApi.available
                    ? formatBytes(stats.live.filesApi.bytes)
                    : "N/A"
                }
              />
            </div>
            {!stats.live.filesApi.available && (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                * 첨부 저장 용량은 Anthropic Files API 실시간 조회값입니다. 키
                미설정·조회 실패 시 N/A 로 표시됩니다. (2MB 이하 인라인 첨부는
                저장되지 않으므로 여기에 포함되지 않습니다.)
              </p>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {/* 모델별 */}
            <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
              <h2 className="mb-3 text-sm font-semibold">모델별 사용량 (누적)</h2>
              {stats.byModel.length === 0 ? (
                <p className="text-xs text-zinc-500">데이터 없음</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                      <th className="pb-1 text-left font-medium">모델</th>
                      <th className="pb-1 text-right font-medium">응답</th>
                      <th className="pb-1 text-right font-medium">입력</th>
                      <th className="pb-1 text-right font-medium">출력</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byModel.map((m) => (
                      <tr
                        key={m.model}
                        className="border-b border-black/[.05] last:border-0 dark:border-white/[.08]"
                      >
                        <td className="py-1.5 font-mono text-xs">{m.model}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {nf(m.count)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">
                          {nf(m.inputTokens)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">
                          {nf(m.outputTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {stats.ledgerTruncated && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  * 원장이 너무 커서 일부만 집계했습니다.
                </p>
              )}
            </div>

            {/* 최근 7일 */}
            <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
              <h2 className="mb-3 text-sm font-semibold">
                최근 7일 (응답 수 · 토큰)
              </h2>
              <div className="flex flex-col gap-1.5">
                {stats.last7Days.map((d) => (
                  <div key={d.date} className="flex items-center gap-2 text-xs">
                    <span className="w-12 shrink-0 text-zinc-500">
                      {d.date.slice(5)}
                    </span>
                    <span className="flex-1">
                      <span
                        className="block h-3 rounded bg-foreground/70"
                        style={{
                          width: `${(d.tokens / maxDayTokens) * 100}%`,
                          minWidth: d.tokens ? "4px" : "0",
                        }}
                      />
                    </span>
                    <span className="w-28 text-right tabular-nums text-zinc-500">
                      {nf(d.messages)}회 · {nf(d.tokens)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 접속 IP 기록 */}
          <section className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">접속 IP 기록</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                고유 IP {nf(stats.access.total)}개
                {stats.access.total > stats.access.rows.length &&
                  ` · 최근 ${stats.access.rows.length}개 표시`}
              </span>
            </div>
            {stats.access.rows.length === 0 ? (
              <p className="text-xs text-zinc-500">기록 없음</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                      <th className="pb-1 pr-4 text-left font-medium">IP</th>
                      <th className="pb-1 pr-4 text-left font-medium">정책</th>
                      <th className="pb-1 pr-8 text-right font-medium">횟수</th>
                      <th className="pb-1 pr-4 text-left font-medium">최근 접속</th>
                      <th className="pb-1 pr-4 text-left font-medium">처음 접속</th>
                      <th className="pb-1 text-left font-medium">User-Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.access.rows.map((r) => {
                      const p = POLICY_LABEL[r.policy] ?? POLICY_LABEL.limited;
                      return (
                        <tr
                          key={r.ip}
                          className="border-b border-black/[.05] last:border-0 dark:border-white/[.08]"
                        >
                          <td className="py-1.5 pr-4 font-mono text-xs">{r.ip}</td>
                          <td className="py-1.5 pr-4">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${p.className}`}
                              >
                                {p.text}
                              </span>
                              {r.policy === "restricted" ? (
                                <button
                                  type="button"
                                  onClick={() => void unrestrictIp(r.ip)}
                                  disabled={ipBusy !== null}
                                  className={smallBtnClass}
                                >
                                  해제
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void restrictIp(r.ip, "")}
                                  disabled={ipBusy !== null || !!restrictedError}
                                  title="이 IP 를 접속 횟수와 무관하게 항상 제한합니다"
                                  className={smallBtnClass}
                                >
                                  제한
                                </button>
                              )}
                            </span>
                          </td>
                          <td className="py-1.5 pr-8 text-right tabular-nums">
                            {nf(r.hits)}
                          </td>
                          <td className="py-1.5 pr-4 text-xs text-zinc-500">
                            {formatDateTime(r.lastSeen)}
                          </td>
                          <td className="py-1.5 pr-4 text-xs text-zinc-500">
                            {formatDateTime(r.firstSeen)}
                          </td>
                          <td
                            className="max-w-[16rem] truncate py-1.5 text-xs text-zinc-500"
                            title={r.userAgent ?? ""}
                          >
                            {r.userAgent ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
