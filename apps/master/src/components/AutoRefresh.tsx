"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the server data of the page every `seconds` while the tab is visible. */
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
