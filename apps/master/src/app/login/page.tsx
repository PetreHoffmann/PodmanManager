import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { loginAction } from "@/app/actions";
import { adminExists } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Page() {
  if (!adminExists()) redirect("/setup");
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      <ActionForm action={loginAction} className="card space-y-3">
        <input name="password" type="password" required autoFocus placeholder="Password" autoComplete="current-password" className="input" />
        
        <button className="btn btn-primary w-full justify-center">Sign in</button>
      </ActionForm>
    </div>
  );
}
