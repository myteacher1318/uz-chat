"use client";

import { useState } from "react";

// 대문 화면 — 8자리 접속 코드를 입력해야 채팅에 입장할 수 있다.
export default function Gate() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || code.length < 8) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        window.location.reload(); // 서버 컴포넌트가 인증 상태로 다시 렌더링
        return;
      }
      setErr("코드가 올바르지 않습니다.");
    } catch {
      setErr("확인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 font-sans">
      <form
        onSubmit={submit}
        className="flex w-full max-w-xs flex-col items-center gap-4"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground text-2xl font-bold text-background">
          U
        </span>
        <div className="text-center">
          <h1 className="text-lg font-semibold">UZ Chat</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            접속 코드를 입력하세요
          </p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
          }
          placeholder="8자리 숫자"
          autoFocus
          className="w-full rounded-xl border border-black/[.1] bg-transparent px-4 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
        />
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button
          type="submit"
          disabled={loading || code.length < 8}
          className="w-full rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "확인 중…" : "입장"}
        </button>
      </form>
    </div>
  );
}
