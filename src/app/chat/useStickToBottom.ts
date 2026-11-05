"use client";

import { useCallback, useRef, useState } from "react";

// 이 거리 안이면 '바닥에 있다'고 본다. 자동 따라가기 여부와 '맨 아래로' 버튼
// 노출을 함께 결정한다. 너무 크면 위로 조금 올려도 계속 끌려가고, 너무 작으면
// 바닥에 있어도 따라가지 않는다.
const BOTTOM_GAP_PX = 80;

/**
 * 메시지 영역의 자동 스크롤. 사용자가 바닥 근처에 있을 때만 새 토큰을 따라가고,
 * 위로 올려 읽는 중이면 방해하지 않는다. 호출 측이 메시지가 바뀔 때마다 follow() 를 부른다.
 */
export function useStickToBottom() {
  const mainRef = useRef<HTMLElement>(null);
  const stickRef = useRef(true); // 사용자가 바닥 근처에 있을 때만 자동 스크롤
  // '맨 아래로' 버튼 노출용 — 자동 스크롤 판단은 위 ref 가, 화면 표시는 이 state 가 맡는다
  const [atBottom, setAtBottom] = useState(true);

  // 바닥에 붙어 있을 때만 끝으로 내린다 (메시지 갱신 직후 호출)
  const follow = useCallback(() => {
    if (!stickRef.current) return;
    const el = mainRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  function nearBottom(el: HTMLElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_GAP_PX;
  }

  function onScroll() {
    const el = mainRef.current;
    if (!el) return;
    const near = nearBottom(el);
    stickRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }

  // 휠·터치는 "사용자가 직접 스크롤을 잡았다"는 확실한 신호다. 위치만으로 판단하면
  // 자동 따라가기가 일으킨 scroll 이벤트와 구분되지 않아, 위로 올려도 다음 토큰이
  // 도착하는 순간 다시 바닥으로 끌려갈 수 있다. 여기서 먼저 끊어 준다.
  function onUserScrollIntent() {
    const el = mainRef.current;
    if (el && !nearBottom(el)) stickRef.current = false;
  }

  function scrollToBottom() {
    const el = mainRef.current;
    if (!el) return;
    // atBottom 은 여기서 미리 켜지 않는다. 스크롤이 실제로 끝났을 때 onScroll
    // 이 갱신하게 두어야, 스크롤이 중간에 막히거나 취소돼도 버튼만 사라지고
    // 위치는 그대로인 상태가 생기지 않는다.
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  return { mainRef, stickRef, atBottom, follow, onScroll, onUserScrollIntent, scrollToBottom };
}
