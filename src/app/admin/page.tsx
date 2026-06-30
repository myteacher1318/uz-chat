import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyToken } from "@/lib/adminAuth";
import LoginForm from "./LoginForm";
import AdminClient from "./AdminClient";

// 쿠키를 읽으므로 항상 동적 렌더링
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const store = await cookies();
  const authed = await verifyToken(store.get(ADMIN_COOKIE)?.value);

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 font-sans">
      {authed ? <AdminClient /> : <LoginForm />}
    </div>
  );
}
