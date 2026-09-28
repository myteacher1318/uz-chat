// 받은 편집 결과를 보낸 원본과 브라우저 안에서 비교한다 — '편집이 안 된다'는 문제를
// 웹과 서버 중 어디서 생기는지 실제 사이트에서 바로 가리기 위한 진단.
// 서버가 쓰는 지표(마스크 안·밖 평균 변화량)와 같은 방식으로 계산한다.
// 모든 데이터는 메모리에서만 다루고 어디에도 저장하지 않는다.

export type Comparison = {
  sameFile: boolean; // 바이트까지 똑같은 파일인가 (= 서버가 원본을 그대로 돌려줌)
  sourceHash: string; // SHA-256 앞 8자리 (서버 로그와 대조용)
  resultHash: string;
  sizeMismatch: string | null; // 크기가 다르면 "결과 가로×세로"
  inside: number | null; // 칠한 영역 안 평균 변화량 (0~255, RGB 평균)
  outside: number | null; // 칠한 영역 밖 (마스크가 없으면 전체)
};

async function shortHash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function pixels(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  } finally {
    bmp.close();
    canvas.width = canvas.height = 0;
  }
}

export async function compareResult(
  source: Blob,
  result: Blob,
  mask: Blob | null,
): Promise<Comparison> {
  const [sourceHash, resultHash] = await Promise.all([shortHash(source), shortHash(result)]);
  const base = { sameFile: sourceHash === resultHash, sourceHash, resultHash };
  const [a, b] = await Promise.all([pixels(source), pixels(result)]);
  if (a.width !== b.width || a.height !== b.height) {
    return { ...base, sizeMismatch: `${b.width}×${b.height}`, inside: null, outside: null };
  }
  const m = mask ? await pixels(mask) : null;
  const useMask = !!m && m.width === a.width && m.height === a.height;
  let inSum = 0, inN = 0, outSum = 0, outN = 0;
  const pa = a.data, pb = b.data, pm = m?.data;
  for (let i = 0; i < pa.length; i += 4) {
    const d =
      (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
    if (useMask && pm![i] >= 128) {
      inSum += d;
      inN++;
    } else {
      outSum += d;
      outN++;
    }
  }
  return {
    ...base,
    sizeMismatch: null,
    inside: inN ? inSum / inN : null,
    outside: outN ? outSum / outN : null,
  };
}
