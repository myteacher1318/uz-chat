import Link from "next/link";

export type Section = "chat" | "image" | "video";

const SECTIONS: { id: Section; href: string; label: string }[] = [
  { id: "chat", href: "/", label: "채팅" },
  { id: "image", href: "/image", label: "이미지" },
  { id: "video", href: "/video", label: "영상" },
];

// 헤더의 '우찌 전용' 배지 바로 오른쪽에 놓는 화면 전환 버튼.
// 지금 화면을 뺀 나머지로 가는 버튼만 보여 준다 — 채팅에선 [이미지][영상],
// 미디어 화면에선 같은 자리 첫 칸에 [채팅]이 온다.
// prefetch 는 끈다: 켜 두면 화면을 열 때마다 나머지 화면을 Render 에 미리 요청해
// 무료 플랜의 요청·대역폭을 쓴다. 끄면 누를 때(데스크톱은 마우스를 올릴 때)만 받는다.
export default function SectionNav({ current }: { current: Section }) {
  return (
    <nav aria-label="화면 전환" className="flex items-center gap-1.5">
      {SECTIONS.filter((s) => s.id !== current).map((s) => (
        <Link
          key={s.id}
          href={s.href}
          prefetch={false}
          className="flex h-8 items-center rounded-lg border border-line bg-raised px-3 text-[13px] font-medium text-foreground/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-accent/40 hover:text-accent"
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
