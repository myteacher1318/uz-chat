// /api/chat 응답은 평문 스트림이라 "사고 요약"과 "답변 본문"을 나눌 별도 채널이 없다.
// 유니코드 사설 사용 영역(Private Use Area) 문자로 구간을 표시한다 — 모델 출력이나
// 사용자 입력에 등장할 일이 없어 오탐 위험이 사실상 없고, 기존 평문 프로토콜과
// 클라이언트의 100ms 버퍼링 구조를 그대로 유지할 수 있다.
//
// 서버(claude.ts)가 사고 구간을 마커로 감싸고, 클라이언트가 걷어내 접이식 영역에
// 표시한다. DB에는 사고를 저장하지 않으므로 저장 직전 stripThinking 으로 제거한다.
//
// ⚠️ 마커는 반드시 \u 이스케이프로 쓸 것. 문자를 그대로 넣으면 편집기에서
//    보이지 않아 실수로 지워지거나 빈 문자열로 오인되기 쉽다.

export const THINK_OPEN = "\uE000";
export const THINK_CLOSE = "\uE001";

// 정상적으로 닫힌 사고 구간 / 중단되어 닫히지 않은 구간 / 짝 없는 닫기 마커
const CLOSED_BLOCK = /\uE000[\s\S]*?\uE001/g;
const DANGLING_OPEN = /\uE000[\s\S]*$/;
const STRAY_CLOSE = /\uE001/g;

/**
 * 사고 구간을 제거한 본문만 돌려준다 (DB 저장·제목 생성용).
 * 응답이 중간에 끊겨 닫기 마커가 없는 경우까지 처리한다.
 */
export function stripThinking(s: string): string {
  return s.replace(CLOSED_BLOCK, "").replace(DANGLING_OPEN, "").replace(STRAY_CLOSE, "");
}
