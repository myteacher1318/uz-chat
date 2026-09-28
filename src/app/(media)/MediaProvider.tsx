"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  MediaApiError,
  createJob,
  fetchResult,
  getJob,
  isTerminal,
  purgeJob,
  type JobKind,
  type JobStatus,
} from "@/lib/mediaApi";

// 이미지·영상 페이지가 공유하는 상태. (media) 레이아웃에 걸려 있어 두 페이지를 오가도
// 유지되고, 새로고침하거나 채팅으로 나가면 전부 사라진다 — 인수인계 문서의 요구대로
// 관리자 키·작업·결과는 React 메모리에만 두고 어떤 브라우저 저장소에도 쓰지 않는다.

const POLL_MS = 2500;

export type ResultItem = { index: number; objectUrl: string; mime: string; size: number };

export type JobView = {
  id: string;
  status: JobStatus;
  expected: number; // 서버가 알려준 결과 개수
  results: ResultItem[];
  // 완료됐지만 아직 받지 못한 결과가 있다 (키가 거부돼 멈춘 경우 키 재입력 뒤 이어 받는다)
  pending: boolean;
  note: string | null; // 화면에 보일 안내 (오류 등)
};

type Jobs = Record<JobKind, JobView | null>;
type Outcome = { ok: true } | { ok: false; message: string };

type MediaContextValue = {
  adminKey: string;
  setAdminKey: (k: string) => void;
  keyRejected: boolean; // 401 을 받아 키를 다시 입력해야 하는 상태
  jobs: Jobs;
  start: (kind: JobKind, form: FormData) => Promise<Outcome>;
  clear: (kind: JobKind) => Promise<Outcome>;
};

const NO_JOBS: Jobs = { image: null, video: null };

const MediaContext = createContext<MediaContextValue | null>(null);

export function useMedia(): MediaContextValue {
  const v = useContext(MediaContext);
  if (!v) throw new Error("useMedia must be used inside MediaProvider");
  return v;
}

function messageOf(e: unknown): string {
  return e instanceof MediaApiError ? e.message : "알 수 없는 오류가 발생했습니다.";
}

type PollDeps = {
  keyRef: RefObject<string>;
  jobsRef: RefObject<Jobs>;
  patchJob: (kind: JobKind, id: string, fn: (j: JobView) => JobView) => void;
  collect: (kind: JobKind, id: string, results: { index: number; url: string }[]) => Promise<boolean>;
  handleError: (kind: JobKind, id: string, e: unknown) => void;
};

/**
 * 작업 상태를 2.5초마다 확인하고, 완료되면 결과를 받는다.
 * 종료 상태가 되거나, 키가 거부됐거나, 작업이 지워지면 멈춘다.
 * 키를 다시 입력하면 이어서 진행한다.
 */
function useJobPolling(
  kind: JobKind,
  job: JobView | null,
  hasKey: boolean,
  keyRejected: boolean,
  { keyRef, jobsRef, patchJob, collect, handleError }: PollDeps,
) {
  const id = job?.id ?? null;
  const active =
    !!job && hasKey && !keyRejected && (!isTerminal(job.status) || job.pending);

  useEffect(() => {
    if (!id || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => !stopped && jobsRef.current[kind]?.id === id;

    const tick = async () => {
      try {
        const info = await getJob(id, keyRef.current);
        if (!isCurrent()) return;
        const done = info.status === "done";
        patchJob(kind, id, (j) => ({
          ...j,
          status: info.status,
          expected: info.resultCount,
          pending: done,
          note:
            info.status === "failed"
              ? `생성에 실패했습니다${info.errorCode ? ` (${info.errorCode})` : ""}.`
              : info.status === "cancelled"
                ? "작업이 취소되었습니다."
                : j.note,
        }));
        if (done) {
          const retry = await collect(kind, id, info.results);
          patchJob(kind, id, (j) => ({ ...j, pending: retry }));
          return;
        }
        if (isTerminal(info.status)) return;
      } catch (e) {
        if (!isCurrent()) return;
        handleError(kind, id, e);
        // 401·404 는 기다려도 풀리지 않는다 (401 은 키를 다시 입력하면 재개)
        if (e instanceof MediaApiError && (e.status === 401 || e.status === 404)) {
          if (e.status === 404) {
            patchJob(kind, id, (j) => ({ ...j, status: "cancelled", pending: false }));
          }
          return;
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [kind, id, active, keyRef, jobsRef, patchJob, collect, handleError]);
}

export default function MediaProvider({ children }: { children: React.ReactNode }) {
  const [adminKey, setAdminKeyState] = useState("");
  const [keyRejected, setKeyRejected] = useState(false);
  const [jobs, setJobsState] = useState<Jobs>(NO_JOBS);
  // 비동기 콜백이 항상 최신 값을 보도록 ref 를 함께 둔다 (state 는 화면 갱신용).
  const keyRef = useRef("");
  const jobsRef = useRef<Jobs>(NO_JOBS);
  // 이미 받았거나 받는 중인 결과 — 결과 URL 은 한 번만 받을 수 있으므로, 폴링이
  // 겹치거나 개발 모드에서 effect 가 두 번 돌아도 같은 결과를 두 번 요청하지 않게 막는다.
  const fetchedRef = useRef(new Set<string>());
  // 이 화면이 만든 모든 결과 object URL — 지우기·페이지 이탈 시 빠짐없이 해제한다.
  const urlsRef = useRef(new Set<string>());

  const updateJobs = useCallback((fn: (j: Jobs) => Jobs) => {
    jobsRef.current = fn(jobsRef.current);
    setJobsState(jobsRef.current);
  }, []);

  // 현재 작업이 여전히 id 인 경우에만 갱신 (지워진 뒤 도착한 응답은 버린다)
  const patchJob = useCallback(
    (kind: JobKind, id: string, fn: (j: JobView) => JobView) => {
      updateJobs((all) => {
        const j = all[kind];
        return j && j.id === id ? { ...all, [kind]: fn(j) } : all;
      });
    },
    [updateJobs],
  );

  const setAdminKey = useCallback((k: string) => {
    keyRef.current = k;
    setAdminKeyState(k);
    setKeyRejected(false);
  }, []);

  // 오류 공통 처리: 401 이면 키 재입력 상태로, 그 외엔 작업에 안내 문구를 단다.
  // 문구에는 프롬프트·키가 들어가지 않는다 (mediaApi 가 서버 코드만 골라 만든다).
  const handleError = useCallback(
    (kind: JobKind, id: string, e: unknown) => {
      if (e instanceof MediaApiError && e.status === 401) setKeyRejected(true);
      patchJob(kind, id, (j) => ({ ...j, note: messageOf(e) }));
    },
    [patchJob],
  );

  // 완료된 작업의 결과를 URL 당 한 번씩 받아 object URL 로 만든다.
  // 반환값: 키 거부로 못 받은 결과가 있어 나중에 다시 받아야 하면 true.
  const collect = useCallback(
    async (kind: JobKind, id: string, results: { index: number; url: string }[]) => {
      let retry = false;
      for (const r of results) {
        const tag = `${id}:${r.index}`;
        if (fetchedRef.current.has(tag)) continue;
        fetchedRef.current.add(tag);
        try {
          const blob = await fetchResult(r.url, keyRef.current);
          if (jobsRef.current[kind]?.id !== id) continue; // 받는 사이에 지워짐
          const objectUrl = URL.createObjectURL(blob);
          urlsRef.current.add(objectUrl);
          const item: ResultItem = { index: r.index, objectUrl, mime: blob.type, size: blob.size };
          patchJob(kind, id, (j) => ({
            ...j,
            results: [...j.results, item].sort((a, b) => a.index - b.index),
          }));
        } catch (e) {
          handleError(kind, id, e);
          // 401 은 서버가 파일을 내주지 않았으므로 키를 고친 뒤 다시 받을 수 있다.
          if (e instanceof MediaApiError && e.status === 401) {
            fetchedRef.current.delete(tag);
            retry = true;
          }
        }
      }
      return retry;
    },
    [handleError, patchJob],
  );

  const pollDeps: PollDeps = { keyRef, jobsRef, patchJob, collect, handleError };
  useJobPolling("image", jobs.image, adminKey !== "", keyRejected, pollDeps);
  useJobPolling("video", jobs.video, adminKey !== "", keyRejected, pollDeps);

  const start = useCallback(
    async (kind: JobKind, form: FormData): Promise<Outcome> => {
      if (!keyRef.current) return { ok: false, message: "관리자 키를 먼저 입력해 주세요." };
      if (jobsRef.current[kind]) {
        return { ok: false, message: "기존 작업 내용을 먼저 지운 뒤 새 작업을 시작해 주세요." };
      }
      try {
        const info = await createJob(kind, keyRef.current, form);
        updateJobs((all) => ({
          ...all,
          [kind]: {
            id: info.id,
            status: info.status,
            expected: info.resultCount,
            results: [],
            pending: false,
            note: null,
          },
        }));
        return { ok: true };
      } catch (e) {
        if (e instanceof MediaApiError && e.status === 401) setKeyRejected(true);
        return { ok: false, message: messageOf(e) };
      }
    },
    [updateJobs],
  );

  // 작업 내용 지우기 — 인수인계 문서의 순서를 따른다.
  //  1) DELETE 호출 → 2) 성공하면 폴링 중단 → 3) object URL 해제 → 4) 작업 항목 제거
  //  5) 실패하면 화면 항목을 남겨 둔 채 재시도를 안내한다.
  // (선택한 업로드 파일·파일 input 은 각 페이지가 ok 를 받은 뒤 비운다)
  const clear = useCallback(
    async (kind: JobKind): Promise<Outcome> => {
      const job = jobsRef.current[kind];
      if (!job) return { ok: true };
      if (!keyRef.current) {
        return { ok: false, message: "관리자 키를 입력한 뒤 다시 눌러 주세요." };
      }
      try {
        await purgeJob(job.id, keyRef.current);
      } catch (e) {
        // 404 는 서버에 이미 아무것도 없다는 뜻이라 지운 것과 같다.
        if (!(e instanceof MediaApiError && e.status === 404)) {
          if (e instanceof MediaApiError && e.status === 401) setKeyRejected(true);
          return { ok: false, message: `지우지 못했습니다. ${messageOf(e)} 다시 눌러 주세요.` };
        }
      }
      // 2) 폴링 중단: ref 에서 먼저 빼면 진행 중이던 폴링 응답이 id 불일치로 버려지고,
      //    state 갱신으로 폴링 effect 도 정리된다.
      jobsRef.current = { ...jobsRef.current, [kind]: null };
      // 3) object URL 해제
      for (const r of job.results) {
        URL.revokeObjectURL(r.objectUrl);
        urlsRef.current.delete(r.objectUrl);
      }
      // 4) 결과 Blob 참조·작업 id·화면 항목 제거
      setJobsState(jobsRef.current);
      return { ok: true };
    },
    [],
  );

  // 화면을 떠날 때(채팅으로 이동·탭 닫기) 만든 URL 을 모두 해제한다.
  // 서버 작업은 지우지 않는다 — 계속 돌 수 있고 15분 정리 규칙이 처리한다.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
    };
  }, []);

  return (
    <MediaContext.Provider value={{ adminKey, setAdminKey, keyRejected, jobs, start, clear }}>
      {children}
    </MediaContext.Provider>
  );
}
