"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import HeaderBrand from "../HeaderBrand";
import SectionNav from "../SectionNav";
import MediaProvider, { useMedia } from "./MediaProvider";
import { Card, inputClass } from "./ui";

// 이미지·영상 화면의 공통 틀: 채팅과 같은 헤더(같은 자리에 [채팅] 버튼) + 관리자 키 입력.
export default function MediaShell({ children }: { children: React.ReactNode }) {
  const current = usePathname() === "/video" ? "video" : "image";
  return (
    <MediaProvider>
      <div className="flex min-h-dvh flex-col font-sans">
        <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-background/90 px-4 py-3 backdrop-blur">
          <HeaderBrand />
          <SectionNav current={current} />
        </header>
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5">
          <AdminKeyField />
          {children}
        </main>
      </div>
    </MediaProvider>
  );
}

// 관리자 키 — Spark 가 받아들인 키는 이 브라우저(localStorage)에 저장돼 다음 방문 때
// 자동으로 채워진다(MediaProvider 참고). 저장된 뒤에는 입력칸을 접어 한 줄로만 보이고,
// 삭제하거나 401 로 거부되면 다시 펼친다. 입력하는 도중에는 접지 않는다.
// <form> 밖에 두고 자동완성을 꺼서 브라우저 비밀번호 관리자가 저장을 제안하지 않게 한다.
//
// 입력 중인 글자는 이 컴포넌트 안에만 두고, Enter 나 포커스 해제 때 확정해 넘긴다.
// 글자마다 넘기면 한 글자짜리 키로 상태 확인이 나가 401 → 칸 비움이 글자마다 반복된다.
function AdminKeyField() {
  const { adminKey, setAdminKey, keySaved, forgetKey, keyRejected } = useMedia();
  const [local, setLocal] = useState(adminKey);
  const focused = useRef(false);

  // 밖에서 바뀐 키(저장된 키 복원·401 로 비움·키 삭제)를 칸에 반영한다.
  // 입력 중에는 건드리지 않는다 — 치고 있는 글자를 지우면 안 된다.
  useEffect(() => {
    if (!focused.current) setLocal(adminKey);
  }, [adminKey]);

  const commit = () => {
    const v = local.trim();
    if (v !== adminKey) setAdminKey(v);
  };

  if (keySaved && !keyRejected) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-raised/60 py-2 pl-4 pr-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <span className="text-emerald-600 dark:text-emerald-400">
          <IconCheck />
        </span>
        <span className="text-sm font-medium">관리자 키 저장됨</span>
        <span className="hidden text-xs text-muted sm:inline">· 공용 기기라면 사용 후 삭제</span>
        <button
          type="button"
          onClick={forgetKey}
          className="ml-auto min-h-9 shrink-0 rounded-lg px-3 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/[.06]"
        >
          키 삭제
        </button>
      </div>
    );
  }

  return (
    <Card>
      <label htmlFor="media-admin-key" className="mb-2 block text-sm font-medium">
        관리자 키
      </label>
      <input
        id="media-admin-key"
        type="password"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        placeholder="Spark 관리자 키"
        aria-invalid={keyRejected}
        className={`${inputClass} ${keyRejected ? "border-red-500/60" : ""}`}
      />
      <p className={`mt-2 text-xs ${keyRejected ? "text-red-500" : "text-muted"}`}>
        {keyRejected
          ? "키가 거부되어 저장된 키를 지웠습니다. 올바른 키를 입력하고 Enter 를 누르면 멈춘 작업을 이어서 확인합니다."
          : "입력 후 Enter(또는 다른 곳 클릭)로 확정합니다. Spark 가 키를 받아들이면 이 브라우저에 저장되고, 이 칸은 접힙니다."}
      </p>
    </Card>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
