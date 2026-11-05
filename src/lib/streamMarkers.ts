// /api/chat 응답은 평문 스트림이라 "사고 요약"·"답변 본문"·"오류 안내"를 나눌 별도
// 채널이 없다. 유니코드 사설 사용 영역(Private Use Area) 문자로 구간을 표시한다 —
// 모델 출력이나 사용자 입력에 등장할 일이 거의 없어 오탐 위험이 사실상 없고, 기존
// 평문 프로토콜과 클라이언트의 100ms 버퍼링 구조를 그대로 유지할 수 있다.
//
// 서버(claude.ts)가 사고 구간을 마커로 감싸고, 클라이언트가 걷어내 접이식 영역에
// 표시한다. DB에는 사고를 저장하지 않으므로 저장 직전 stripThinking 으로 제거한다.
//
// ERROR_MARK 는 서버가 스트림 도중 오류를 만났을 때 안내 문구 앞에 붙인다. 클라이언트는
// 이 뒤의 텍스트를 본문이 아니라 오류 안내로 다루어, 사고 구간 안에 숨지도 않고
// 다음 턴에 "AI 가 한 말"로 되돌려 보내지도 않는다.
//
// ⚠️ 마커는 반드시 \u 이스케이프로 쓸 것. 문자를 그대로 넣으면 편집기에서
//    보이지 않아 실수로 지워지거나 빈 문자열로 오인되기 쉽다.

export const THINK_OPEN = "";
export const THINK_CLOSE = "";
export const ERROR_MARK = "";

// 정상적으로 닫힌 사고 구간 / 중단되어 닫히지 않은 구간 / 짝 없는 닫기 마커
const CLOSED_BLOCK = /[\s\S]*?/g;
const DANGLING_OPEN = /[\s\S]*$/;
const STRAY_CLOSE = //g;

/**
 * 사고 구간을 제거한 본문만 돌려준다 (DB 저장·제목 생성용).
 * 응답이 중간에 끊겨 닫기 마커가 없는 경우까지 처리한다.
 */
export function stripThinking(s: string): string {
  return s.replace(CLOSED_BLOCK, "").replace(DANGLING_OPEN, "").replace(STRAY_CLOSE, "");
}

/**
 * 모델 출력(또는 사용자 입력)에 사설 사용 영역 문자가 섞여 있으면 마커와 충돌해
 * 사고/본문 구분이 뒤집힌다 (Nerd Font 아이콘 글자 등 — 드물지만 가능).
 * 스트림에 흘려보내기 전에 걸러 낸다. 마커 3개만 지우면 되지만, 같은 영역의 다른
 * 문자가 나중에 마커로 추가될 수 있어 U+E000~U+E00F 를 통째로 지운다.
 */
export function stripMarkerChars(s: string): string {
  return s.replace(/[-]/g, "");
}
