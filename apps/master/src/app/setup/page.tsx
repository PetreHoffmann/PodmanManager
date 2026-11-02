import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { setupAction } from "@/app/actions";
import { adminExists } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Page() {
  if (adminExists()) redirect("/login");
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-4 text-xl font-semibold">Create admin password</h1>
      <ActionForm action={setupAction} className="card space-y-3">
        <input name="password" type="password" required autoFocus placeholder="Password" autoComplete="new-password" className="input" />
        <input name="confirm" type="password" required placeholder="Repeat password" autoComplete="new-password" className="input" />
        <button className="btn btn-primary w-full justify-center">Create admin password</button>
      </ActionForm>
    </div>
  );
}
