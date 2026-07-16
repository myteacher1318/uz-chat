"use client";

import { useState } from "react";

// 대문 화면 — 8자리 접속 코드를 입력해야 채팅에 입장할 수 있다.
export default function Gate() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || code.trim().length === 0) return;
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
      // 서버가 준 메시지(레이트리밋 등)를 우선 표시
      let msg = "코드가 올바르지 않습니다.";
      try {
        const d = await res.json();
        if (typeof d?.error === "string") msg = d.error;
      } catch {
        /* noop */
      }
      setErr(msg);
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
        <span className="flex h-14 w-14 select-none items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-xl font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
          UZ
        </span>
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">UZ Chat</h1>
          <p className="mt-1 text-sm text-muted">접속 코드를 입력하세요</p>
        </div>
        <input
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="접속 코드"
          autoFocus
          className="w-full rounded-xl border border-line bg-raised px-4 py-3 text-center text-lg tracking-[0.3em] shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-colors focus:border-accent/60"
        />
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button
          type="submit"
          disabled={loading || code.trim().length === 0}
          className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-colors hover:bg-accent-strong disabled:opacity-40"
        >
          {loading ? "확인 중…" : "입장"}
        </button>
      </form>
    </div>
  );
}
