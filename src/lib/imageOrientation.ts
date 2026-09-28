// 휴대폰 사진(JPEG)의 EXIF 회전 정보 처리.
//
// 브라우저는 회전 정보를 적용한 크기(예: 세로 사진 3024×4032)로 이미지를 보여 주고,
// 부분 편집 마스크도 그 크기로 만든다. 그런데 파일 안의 실제 픽셀은 회전 전(4032×3024)
// 이라, 서버가 회전을 적용하지 않고 크기를 비교하면 마스크와 원본 크기가 어긋난다.
// 마스크를 보낼 때는 회전을 픽셀에 반영한 원본을 보내 이 차이를 없앤다.

/** JPEG 의 EXIF Orientation(0x0112) 값. JPEG 가 아니거나 정보가 없으면 1(회전 없음). */
export async function jpegOrientation(file: Blob): Promise<number> {
  if (file.type !== "image/jpeg") return 1;
  const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off + 4 <= view.byteLength) {
    const marker = view.getUint16(off);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1; // 본문 시작 — 메타데이터 끝
    const len = view.getUint16(off + 2);
    // APP1 "Exif\0\0" 뒤에 TIFF 헤더가 온다
    if (marker === 0xffe1 && off + 10 <= view.byteLength && view.getUint32(off + 4) === 0x45786966) {
      const tiff = off + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949; // "II" = 리틀 엔디언
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const count = view.getUint16(ifd, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    off += 2 + len;
  }
  return 1;
}

/**
 * 회전 정보(2~8)가 있는 JPEG 는 회전을 픽셀에 반영해 다시 저장한 파일을, 그 밖에는
 * 원래 파일을 그대로 돌려준다. 다시 저장한 JPEG 에는 회전 정보가 없다.
 */
export async function bakeOrientation(file: File): Promise<File> {
  const orientation = await jpegOrientation(file);
  if (orientation <= 1 || orientation > 8) return file;
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("orientation bake failed"))),
        "image/jpeg",
        0.95,
      );
    });
    return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bmp.close();
    canvas.width = canvas.height = 0;
  }
}
