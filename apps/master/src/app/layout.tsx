import type { Metadata } from "next";
import { I18nProvider } from "@/components/I18nProvider";
import { getLang } from "@/lib/lang";
import "./globals.css";

export const metadata: Metadata = {
  title: "PodmanManager",
  other: { google: "notranslate" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} translate="no" className="dark notranslate">
      <body className="notranslate min-h-screen" translate="no">
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
