import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { ALLOWED_TYPES, MAX_FILE_BYTES } from "@/lib/attachments";

// 브라우저가 큰 파일을 Vercel Blob에 '직접' 업로드할 수 있도록 토큰을 발급한다.
// (파일 바이트가 이 서버리스 함수의 4.5MB 본문 한계를 거치지 않게 하는 핵심.)
// 동작하려면 Vercel Blob 스토어와 BLOB_READ_WRITE_TOKEN 환경변수가 필요하다.
export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [...ALLOWED_TYPES],
        maximumSizeInBytes: MAX_FILE_BYTES,
        addRandomSuffix: true,
      }),
      // 클라이언트 업로드 완료 콜백 (로컬에서는 호출되지 않을 수 있음)
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "업로드 토큰 발급 실패";
    return Response.json({ error: msg }, { status: 400 });
  }
}
