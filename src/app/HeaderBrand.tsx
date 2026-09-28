// 헤더 왼쪽의 로고·제목·'우찌 전용' 배지. 채팅·이미지·영상 화면이 같이 써서
// 오른쪽에 붙는 화면 전환 버튼이 세 화면에서 같은 자리에 오게 한다.
export default function HeaderBrand() {
  return (
    <>
      <span className="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-[11px] font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
        UZ
      </span>
      {/* 360px 폭 휴대폰에선 전환 버튼까지 한 줄에 들어가도록 제목 글자만 숨긴다 */}
      <h1 className="text-[15px] font-semibold tracking-tight max-[374px]:sr-only">UZ Chat</h1>
      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
        우찌 전용
      </span>
    </>
  );
}
