"use client";

import { useState } from "react";

export default function LoginForm() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || pw === "") return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        window.location.reload(); // 서버 컴포넌트가 인증 상태로 다시 렌더링
        return;
      }
      setErr("비밀번호가 올바르지 않습니다.");
    } catch {
      setErr("로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-24 flex max-w-sm flex-col gap-3"
    >
      <h1 className="text-lg font-semibold">관리자 로그인</h1>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="비밀번호"
        autoFocus
        className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
      />
      {err && <p className="text-sm text-red-500">{err}</p>}
      <button
        type="submit"
        disabled={loading || pw === ""}
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {loading ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
