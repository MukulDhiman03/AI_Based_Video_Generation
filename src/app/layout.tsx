import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VidSutra.ai", template: "%s · VidSutra.ai" },
  description:
    "Your ideas, beautifully explained. A creative studio for animated explainers.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  themeColor: "#11131a",
  colorScheme: "dark",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
