"use client";

import { IconPlus, IconTrash } from "./icons";
import { formatListDate, formatMessageTime, type Conversation } from "./types";

export function Sidebar({
  open,
  onClose,
  conversations,
  activeId,
  listError,
  search,
  onSearchChange,
  onNew,
  onSelect,
  onDeleteRequest,
}: {
  open: boolean; // 모바일에서 펼쳐진 상태 (md 이상에서는 항상 보인다)
  onClose: () => void;
  conversations: Conversation[];
  activeId: string | null;
  listError: string | null;
  search: string;
  onSearchChange: (q: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDeleteRequest: (c: Conversation) => void;
}) {
  const searching = search.trim() !== "";
  return (
    <>
      {/* 모바일 백드롭 */}
      {open && (
        <div className="fixed inset-0 z-10 bg-black/40 md:hidden" onClick={onClose} />
      )}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-20 flex w-64 transform flex-col border-r border-line bg-surface shadow-xl transition-transform md:static md:z-auto md:translate-x-0 md:shadow-none",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-raised px-3 py-2.5 text-sm font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-accent/40 hover:text-accent"
          >
            <IconPlus />새 대화
          </button>
        </div>
        <div className="px-4 pb-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="대화 검색"
            aria-label="대화 검색"
            className="w-full rounded-lg border border-line bg-raised px-3 py-1.5 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-accent/40"
          />
        </div>
        <p className="px-5 pb-1.5 text-[11px] font-medium tracking-wider text-muted/80">
          {searching ? "검색 결과" : "대화 목록"}
        </p>
        <nav className="nice-scroll flex-1 overflow-y-auto px-2 pb-3">
          {listError && (
            <p role="alert" className="px-3 py-2 text-xs text-red-500">
              {listError}
            </p>
          )}
          {conversations.length === 0 ? (
            !listError && (
              <p className="px-2 py-4 text-center text-xs text-muted/70">
                {searching ? "검색 결과가 없습니다" : "대화가 없습니다"}
              </p>
            )
          ) : (
            <ul className="flex flex-col gap-0.5">
              {conversations.map((c) => {
                const active = c.id === activeId;
                const dateLabel = formatListDate(c.updated_at);
                return (
                  <li
                    key={c.id}
                    className={[
                      "group flex items-center rounded-lg transition-colors",
                      active
                        ? "bg-accent-soft text-foreground"
                        : "text-foreground/75 hover:bg-foreground/[.05] hover:text-foreground",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className="flex-1 truncate px-3 py-2 text-left text-sm"
                      title={c.title}
                    >
                      {c.title}
                    </button>
                    {/* 마지막으로 대화한 날짜 — 언제 나눈 대화인지 목록에서 바로 보인다 */}
                    {dateLabel && (
                      <time
                        dateTime={c.updated_at}
                        title={formatMessageTime(c.updated_at) ?? undefined}
                        className="shrink-0 pr-1 text-[11px] tabular-nums text-muted/70"
                      >
                        {dateLabel}
                      </time>
                    )}
                    {/*
                      모바일에는 hover가 없다. hidden + group-hover:flex 로 두면
                      터치 기기에서 삭제 버튼에 영영 닿을 수 없으므로, 메시지 액션과
                      같은 방식으로 md 이상에서만 hover(및 키보드 포커스)로 감춘다.
                    */}
                    <button
                      type="button"
                      onClick={() => onDeleteRequest(c)}
                      aria-label="대화 삭제"
                      title="삭제"
                      className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-opacity hover:bg-foreground/[.06] hover:text-red-500 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                    >
                      <IconTrash />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>
    </>
  );
}
