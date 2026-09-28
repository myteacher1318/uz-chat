// Spark 비공개 미디어 API 클라이언트 (이미지 생성·편집, 영상 생성).
// 브라우저에서 Spark 로 직접 호출한다 — 이 앱의 서버를 거치지 않으므로 프롬프트·파일·
// 관리자 키가 Render 에 닿지 않는다. 관리자 키는 호출자가 매번 인자로 넘기고, 이 모듈은
// 아무것도 저장하지 않는다. (키의 localStorage 저장은 MediaProvider 가 맡는다 —
// 키 말고는 어떤 브라우저 저장소에도 남기지 않는다)
//
// Render 를 거치지 않는 것은 의도다: 업로드·결과 파일·폴링이 Render 무료 플랜의 대역폭과
// 메모리를 쓰지 않고, 프롬프트와 키가 중간 서버에 남지 않는다. 서버 프록시를 만들지 말 것.
//
// ⚠️ 접속 조건 — 어긋나면 모든 요청이 "연결하지 못했습니다"로 끝난다.
//  1) 주소는 Tailscale 의 HTTPS 이름을 쓴다(Funnel 로 공개돼 있어 Tailscale 없는 기기도
//     닿는다). IP(100.88.231.75)는 쓰지 않는다 — 이 사이트는 HTTPS 라 http://IP 호출은
//     혼합 콘텐츠로 차단되고, IP 로는 유효한 인증서가 없다.
//  2) Spark 는 등록된 Origin 하나만 받는다 — 이 사이트(https://uz-chat-kcvj.onrender.com)의
//     SHA-256 해시가 등록돼 있다. 그 밖의 호스트(localhost·preview)는 403 origin_not_allowed
//     가 정상이라, 로컬에선 실제 Spark 대신 같은 계약의 모의 서버로 시험한다.

export const MEDIA_API_BASE = (
  process.env.NEXT_PUBLIC_MEDIA_API_BASE ??
  "https://duksoo-spark.tailc9dfa1.ts.net/private-media-api"
).replace(/\/+$/, "");

// 파일 한 장 상한 (서버와 동일)
export const MEDIA_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MEDIA_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MEDIA_ACCEPT = MEDIA_IMAGE_TYPES.join(",");
export const VIDEO_MAX_IMAGES = 9;

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type JobKind = "image" | "video";

export type JobInfo = {
  id: string;
  status: JobStatus;
  resultCount: number;
  results: { index: number; url: string }[];
  errorCode: string | null;
  expiresAt: number | null;
};

export function isTerminal(s: JobStatus): boolean {
  return s === "done" || s === "failed" || s === "cancelled";
}

/** 서버 응답 코드를 담은 오류. message 는 화면에 그대로 보여도 되는 문구만 담는다. */
export class MediaApiError extends Error {
  constructor(
    readonly status: number, // 0 = 네트워크/CORS 실패
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

// 서버가 정한 오류 코드(private_queue_busy 등)만 꺼낸다. 응답 본문의 다른 내용은
// 버린다 — 입력 검증 오류가 요청 값(프롬프트)을 되돌려 줄 수 있어서다.
function pickCode(d: unknown): string | null {
  const o = (d ?? {}) as Record<string, unknown>;
  const nested = (v: unknown) =>
    v && typeof v === "object" ? (v as Record<string, unknown>).code : undefined;
  const candidates = [nested(o.error), o.code, o.error, nested(o.detail), o.detail];
  for (const c of candidates) {
    if (typeof c === "string" && /^[a-z0-9_]{1,64}$/.test(c)) return c;
  }
  return null;
}

function describe(status: number, code: string | null, what: "job" | "result"): string {
  const tag = code ? ` (${code})` : "";
  switch (status) {
    case 400:
      return `입력값을 다시 확인해 주세요${tag}.`;
    case 401:
      return "관리자 키가 올바르지 않습니다. 키를 다시 입력해 주세요.";
    case 404:
      return what === "result"
        ? "결과를 이미 받았거나 만료되었습니다."
        : "작업을 찾을 수 없습니다. 만료되었거나 이미 지워졌습니다.";
    case 413:
      return "파일이 너무 큽니다. 한 장당 25MB 이하만 올릴 수 있습니다.";
    case 429:
      return "이미 진행 중인 작업이 있습니다. 그 작업이 끝난 뒤 다시 시도해 주세요.";
    case 503:
      return "Spark/ComfyUI 가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return `요청이 실패했습니다 (HTTP ${status}${tag}).`;
  }
}

/**
 * 결과 경로를 절대 URL로. 인수인계 문서대로 base URL 뒤에 붙인다.
 * (new URL("/v1/...", base) 는 base 의 /private-media-api 경로를 버리므로 쓰지 않는다)
 * 관리자 키를 실어 보내므로 base 와 다른 호스트로는 절대 보내지 않는다.
 */
export function resolveMediaUrl(path: string): string {
  const base = new URL(MEDIA_API_BASE);
  if (/^https?:\/\//i.test(path)) {
    if (new URL(path).origin !== base.origin) {
      throw new MediaApiError(0, null, "결과 주소가 Spark 서버가 아닙니다.");
    }
    return path;
  }
  const p = path.startsWith("/") ? path : `/${path}`;
  const prefix = base.pathname.replace(/\/+$/, "");
  // 서버가 이미 접두 경로까지 붙여 준 경우 두 번 붙이지 않는다.
  if (prefix && (p === prefix || p.startsWith(`${prefix}/`))) return base.origin + p;
  return MEDIA_API_BASE + p;
}

async function call(
  url: string,
  key: string,
  what: "job" | "result",
  init: RequestInit = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${key}` },
      // 브라우저 HTTP 캐시에도 남기지 않는다. 쿠키·Referer 도 보내지 않는다.
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new MediaApiError(
      0,
      null,
      "Spark 서버에 연결하지 못했습니다. 네트워크 또는 서버의 접속 허용(Origin) 설정을 확인해 주세요.",
    );
  }
  if (!res.ok) {
    let code: string | null = null;
    try {
      code = pickCode(await res.json());
    } catch {
      /* 본문이 JSON 이 아님 */
    }
    throw new MediaApiError(res.status, code, describe(res.status, code, what));
  }
  return res;
}

function toJobInfo(d: unknown): JobInfo {
  const o = (d ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) {
    throw new MediaApiError(0, null, "서버 응답에 작업 id 가 없습니다.");
  }
  const statuses: JobStatus[] = ["queued", "running", "done", "failed", "cancelled"];
  const status = statuses.includes(o.status as JobStatus) ? (o.status as JobStatus) : "queued";
  const results = Array.isArray(o.results)
    ? o.results
        .map((r) => r as Record<string, unknown>)
        .filter((r) => typeof r.url === "string")
        .map((r, i) => ({ index: typeof r.index === "number" ? r.index : i, url: r.url as string }))
    : [];
  return {
    id: o.id,
    status,
    resultCount: typeof o.result_count === "number" ? o.result_count : results.length,
    results,
    errorCode: pickCode({ error: o.error }),
    expiresAt: typeof o.expires_at === "number" ? o.expires_at : null,
  };
}

export async function createJob(kind: JobKind, key: string, form: FormData): Promise<JobInfo> {
  const path = kind === "image" ? "/v1/image-jobs" : "/v1/video-jobs";
  const res = await call(MEDIA_API_BASE + path, key, "job", { method: "POST", body: form });
  return toJobInfo(await res.json());
}

export async function getJob(id: string, key: string): Promise<JobInfo> {
  const res = await call(`${MEDIA_API_BASE}/v1/jobs/${encodeURIComponent(id)}`, key, "job");
  return toJobInfo(await res.json());
}

/** 작업 취소 + 서버 메모리의 프롬프트·업로드·결과를 한 번에 폐기. */
export async function purgeJob(id: string, key: string): Promise<void> {
  await call(`${MEDIA_API_BASE}/v1/jobs/${encodeURIComponent(id)}`, key, "job", {
    method: "DELETE",
  });
}

/**
 * 결과 파일을 받는다. 서버는 첫 응답이 끝나면 파일을 지우므로 URL 당 정확히 한 번만
 * 호출해야 한다 — 받은 Blob 하나로 미리보기와 다운로드를 함께 쓴다.
 */
export async function fetchResult(url: string, key: string): Promise<Blob> {
  const res = await call(resolveMediaUrl(url), key, "result");
  return res.blob();
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function extensionFor(mime: string): string {
  return EXT[mime.split(";")[0].trim().toLowerCase()] ?? "bin";
}
