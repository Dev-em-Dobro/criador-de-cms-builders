import type { Metadata } from "next";
import clientConfig from "@/client.config";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${clientConfig.branding.adminTitle} CMS`,
  description: `Content management for ${clientConfig.displayName}.`,
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    {/* `lang` vem do config: era "en" fixo, o que declarava o idioma errado
        para qualquer cliente não-inglês (leitores de tela, tradutor do browser). */}
    <html lang={clientConfig.locales.default} className={poppins.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
