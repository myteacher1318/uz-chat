"use client";

import { useEffect, useState } from "react";

type Stats = {
  conversations: number;
  messages: { total: number; user: number; assistant: number; withAttachments: number };
  byModel: { model: string; count: number }[];
  last7Days: { date: string; count: number }[];
};

export default function AdminClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [limit, setLimit] = useState<string>("");
  const [savedLimit, setSavedLimit] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoadingStats(true);
    setErr(null);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/settings"),
      ]);
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

  async function logout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      window.location.reload();
    }
  }

  const maxDay = stats
    ? Math.max(1, ...stats.last7Days.map((d) => d.count))
    : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">관리자</h1>
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="rounded-lg border border-black/[.1] px-3 py-1.5 text-sm transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
          >
            ← 채팅으로
          </a>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-black/[.1] px-3 py-1.5 text-sm transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
          >
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

      {/* 사용량 통계 */}
      {loadingStats ? (
        <p className="text-sm text-zinc-500">통계 불러오는 중…</p>
      ) : stats ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="총 대화" value={stats.conversations} />
            <StatCard label="총 메시지" value={stats.messages.total} />
            <StatCard label="사용자" value={stats.messages.user} />
            <StatCard label="어시스턴트" value={stats.messages.assistant} />
            <StatCard label="첨부 포함" value={stats.messages.withAttachments} />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
              <h2 className="mb-3 text-sm font-semibold">모델별 응답 수</h2>
              {stats.byModel.length === 0 ? (
                <p className="text-xs text-zinc-500">데이터 없음</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {stats.byModel.map((m) => (
                      <tr
                        key={m.model}
                        className="border-b border-black/[.05] last:border-0 dark:border-white/[.08]"
                      >
                        <td className="py-1.5 font-mono text-xs">{m.model}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {m.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
              <h2 className="mb-3 text-sm font-semibold">최근 7일 메시지</h2>
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
                          width: `${(d.count / maxDay) * 100}%`,
                          minWidth: d.count ? "4px" : "0",
                        }}
                      />
                    </span>
                    <span className="w-8 text-right tabular-nums text-zinc-500">
                      {d.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.12]">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
