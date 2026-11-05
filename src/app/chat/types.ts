// 채팅 화면이 쓰는 타입과 순수 함수. 훅·컴포넌트가 함께 import 한다.

export type Conversation = { id: string; title: string; updated_at: string };

export type UIAttachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  data?: string; // 작은 파일: base64 인라인
  fileId?: string; // 큰 파일: Files API 참조
  previewUrl?: string; // 이미지 미리보기용 objectURL (전송하지 않음)
  uploading?: boolean; // Blob+Files 업로드 진행 중
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: UIAttachment[];
  error?: boolean;
  streaming?: boolean;
  // 사고 요약 — 화면 표시 전용이라 DB에 저장하지 않고 새로고침하면 사라진다.
  thinking?: string;
  // 본문 일부가 온 뒤 서버에서 오류가 난 경우의 안내. 본문과 따로 보여주고,
  // 다음 턴에 모델로 되돌려 보내지 않는다 (content 만 보낸다).
  errorNote?: string;
  // 작성 시각(ISO). 불러온 메시지는 DB의 created_at, 방금 보낸 메시지는 전송 시각.
  createdAt?: string;
};

/** 복원된 첨부 중 더 이상 모델에 보낼 데이터가 없는 것 (2MB 이하 인라인 첨부). */
export function isDetachedAttachment(a: UIAttachment): boolean {
  return !a.data && !a.fileId && !a.previewUrl && !a.uploading;
}

// /api/messages 가 돌려주는 행
export type MessageRow = {
  role: "user" | "assistant";
  content: string;
  attachments: { name: string; type: string; fileId?: string }[] | null;
  created_at: string;
};

export function rowsToMessages(rows: MessageRow[]): Message[] {
  return rows.map((r) => ({
    id: crypto.randomUUID(),
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    attachments: Array.isArray(r.attachments)
      ? r.attachments.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          mediaType: a.type,
          size: 0,
          // Files API 첨부는 fileId를 복원해 새로고침 후에도
          // 후속 질문에서 파일 문맥이 유지되게 한다.
          fileId: typeof a.fileId === "string" ? a.fileId : undefined,
        }))
      : undefined,
  }));
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,XXXX"
      resolve(res.slice(res.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// 답변 아래 시각 — "2026년 11월 5일 오후 2:32". 브라우저 시간대로 표시한다.
const MESSAGE_TIME_FMT = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
// 대화 목록 날짜 — 올해면 "11. 5.", 다른 해면 "2025. 3. 2."
const LIST_DATE_FMT = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
});
const LIST_DATE_FMT_WITH_YEAR = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function formatMessageTime(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : MESSAGE_TIME_FMT.format(d);
}

export function formatListDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? LIST_DATE_FMT : LIST_DATE_FMT_WITH_YEAR).format(d);
}

// 서버가 돌려준 짧은 오류 코드(proxy 미들웨어 등)를 사람이 읽을 문구로.
// 코드가 아니면(이미 문장이면) 그대로 돌려준다.
export function describeApiError(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.replace(/^⚠️\s*/, "").trim() : "";
  switch (s) {
    case "gate_required":
      return "접속 코드 인증이 만료되었습니다. 페이지를 새로고침해 코드를 다시 입력해 주세요.";
    case "region_blocked":
      return "해외 IP 에서는 사용할 수 없습니다.";
    case "unauthorized":
      return "권한이 없습니다. 페이지를 새로고침해 주세요.";
    case "":
      return fallback;
    default:
      return s;
  }
}

// fetch 응답의 { error } 본문을 읽어 문구로. JSON 이 아니면 기본 문구.
export async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const d = await res.json();
    return describeApiError(d?.error, fallback);
  } catch {
    return fallback;
  }
}
