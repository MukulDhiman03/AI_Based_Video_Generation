import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function NotFound() {
  return (
    <AuthFrame>
      <div className="not-found">
        <div className="eyebrow">One step at a time</div>
        <h1>This page isn’t here yet.</h1>
        <p>
          We’re building VidSutra, starting with your account. Head back to sign
          in.
        </p>
        <Link className="primary-button" href="/sign-in">
          Back to sign in
          <ArrowRight size={16} />
        </Link>
      </div>
    </AuthFrame>
  );
}
