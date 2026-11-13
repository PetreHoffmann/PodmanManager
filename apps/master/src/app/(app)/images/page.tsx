import { redirect } from "next/navigation";

/** Images moved into the Resources page. */
export default function Page() {
  redirect("/resources?tab=images");
}
