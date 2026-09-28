"use client";

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

// 관리자 키 — 비밀번호 칸. Spark 가 받아들인 키는 이 브라우저(localStorage)에 저장돼
// 다음 방문 때 자동으로 채워진다(MediaProvider 참고). <form> 밖에 두고 자동완성을 꺼서
// 브라우저 비밀번호 관리자가 따로 저장을 제안하지 않게 한다.
function AdminKeyField() {
  const { adminKey, setAdminKey, keySaved, forgetKey, keyRejected } = useMedia();
  const help = keyRejected
    ? "키가 거부되어 저장된 키를 지웠습니다. 올바른 키를 다시 입력하면 멈춘 작업을 이어서 확인합니다."
    : keySaved
      ? "이 브라우저에 저장된 키입니다. 공용 기기라면 사용 후 삭제해 주세요."
      : "Spark 가 키를 받아들이면 이 브라우저에 저장되어 다음에 자동으로 채워집니다.";
  return (
    <Card>
      <label htmlFor="media-admin-key" className="mb-2 block text-sm font-medium">
        관리자 키
      </label>
      <div className="flex gap-2">
        <input
          id="media-admin-key"
          type="password"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          placeholder="Spark 관리자 키"
          aria-invalid={keyRejected}
          className={`${inputClass} min-w-0 flex-1 ${keyRejected ? "border-red-500/60" : ""}`}
        />
        {keySaved && (
          <button
            type="button"
            onClick={forgetKey}
            className="shrink-0 rounded-xl border border-red-500/40 px-3 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/[.06]"
          >
            저장된 키 삭제
          </button>
        )}
      </div>
      <p className={`mt-2 text-xs ${keyRejected ? "text-red-500" : "text-muted"}`}>{help}</p>
    </Card>
  );
}
