import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export function AuthFrame({
  children,
  signup = false,
}: {
  children: React.ReactNode;
  signup?: boolean;
}) {
  return (
    <div className={`auth-page${signup ? " signup-page" : ""}`}>
      <div className="auth-shell">
        <Link
          href="/sign-in"
          className="brand"
          aria-label="VidSutra.ai sign in"
        >
          <span className="brand-icon" aria-hidden="true">
            <BrandMark />
          </span>
          <span className="brand-name">
            VidSutra<span>.ai</span>
          </span>
        </Link>
        <main id="main-content" className="auth-card">
          {children}
        </main>
        <footer className="auth-footer">
          <span>© {new Date().getFullYear()} VidSutra.ai</span>
          <span>
            <ShieldCheck aria-hidden="true" />
            VidSutra beta · Open to everyone
          </span>
        </footer>
      </div>
    </div>
  );
}
