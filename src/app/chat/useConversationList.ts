"use client";

import { useEffect, useRef, useState } from "react";
import { readApiError, type Conversation } from "./types";

/** 사이드바 대화 목록 + 검색. 실패하면 listError 에 문구를 남긴다. */
export function useConversationList() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  // 대화 목록 검색어 (제목 + 메시지 본문을 서버에서 함께 찾는다)
  const [search, setSearch] = useState("");
  // ref로도 들고 있는다 — refresh 는 목록 갱신이 필요한 여러 곳(새 대화·삭제·전송 후)
  // 에서 불리는데, 그때마다 최신 검색어를 봐야 한다.
  const searchRef = useRef("");
  const firstRun = useRef(true);

  async function refresh(): Promise<Conversation[]> {
    try {
      const q = searchRef.current.trim();
      const res = await fetch(
        q ? `/api/conversations?q=${encodeURIComponent(q)}` : "/api/conversations",
      );
      if (!res.ok) {
        setListError(await readApiError(res, "대화 목록을 불러오지 못했습니다."));
        return [];
      }
      const list = (await res.json()) as Conversation[];
      setConversations(list);
      setListError(null);
      return list;
    } catch {
      setListError("대화 목록을 불러오지 못했습니다. 네트워크를 확인해 주세요.");
      return [];
    }
  }

  // 검색어 변경 시 목록 재조회 — 입력 중 매 글자마다 조회하지 않도록 디바운스.
  // 최초 마운트에서는 별도의 초기 로드가 이미 돌므로 건너뛴다.
  useEffect(() => {
    searchRef.current = search;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void refresh();
    }, 250);
    return () => clearTimeout(timer);
    // refresh 는 ref로 최신 검색어를 읽으므로 의존성이 필요 없다.
  }, [search]);

  return { conversations, listError, search, setSearch, refresh };
}
