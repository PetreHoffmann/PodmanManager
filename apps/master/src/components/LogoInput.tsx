"use client";

import { useRef } from "react";

/** The navbar shows the logo at most 32 px high; 4x keeps it sharp on high-DPI screens. */
const MAX_W = 512;
const MAX_H = 128;

/**
 * File input for the navbar logo. Raster images larger than MAX_W x MAX_H are scaled down in the
 * browser (aspect ratio kept, never enlarged) before upload, so big photos/logos stay small.
 * SVG and small images are sent unchanged. The server validates size and type again.
 */
export default function LogoInput({ name, accept }: { name: string; accept: string }) {
  const ref = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const f = input.files?.[0];
    if (!f || !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, MAX_W / bmp.width, MAX_H / bmp.height);
      if (k >= 1 && f.size <= 256 * 1024) {
        bmp.close();
        return;
      }
      const w = Math.max(1, Math.round(bmp.width * k));
      const h = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) return;
      const dt = new DataTransfer();
      dt.items.add(new File([blob], f.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" }));
      input.files = dt.files;
    } catch {
      /* unreadable image: leave the file as it is, the server will answer */
    }
  }

  return <input ref={ref} name={name} type="file" accept={accept} onChange={onChange} className="input mt-1" />;
}
