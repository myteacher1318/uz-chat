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

// 관리자 키 — 비밀번호 칸이고 React 메모리에만 둔다. 새로고침하거나 채팅으로 나가면
// 사라진다. <form> 밖에 두고 자동완성을 꺼서 브라우저가 저장을 제안하지 않게 한다.
function AdminKeyField() {
  const { adminKey, setAdminKey, keyRejected } = useMedia();
  return (
    <Card>
      <label htmlFor="media-admin-key" className="mb-2 block text-sm font-medium">
        관리자 키
      </label>
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
        className={`${inputClass} ${keyRejected ? "border-red-500/60" : ""}`}
      />
      <p className={`mt-2 text-xs ${keyRejected ? "text-red-500" : "text-muted"}`}>
        {keyRejected
          ? "키가 거부되었습니다. 올바른 키를 다시 입력하면 멈춘 작업을 이어서 확인합니다."
          : "이 탭의 메모리에만 있고, 새로고침하거나 채팅으로 돌아가면 지워집니다."}
      </p>
    </Card>
  );
}
