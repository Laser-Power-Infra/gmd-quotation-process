import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import StoreProvider from "./StoreProvider";
import Navbar from "@/components/layout/Navbar";
import { Toaster } from "@/components/ui/sonner";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GMD Quotation Process",
  description: "A web application for managing quotations in the GMD quotation process.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col overflow-x-hidden overflow-y-hidden">
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem("theme");
                if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
                  document.documentElement.classList.add("dark");
                }
              } catch(e) {}
            `,
          }}
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block"
        />
        <StoreProvider>
          <Navbar />
          {children}
          <Toaster position="top-right" richColors theme="light"/>
        </StoreProvider>
      </body>
    </html>
  );
}
