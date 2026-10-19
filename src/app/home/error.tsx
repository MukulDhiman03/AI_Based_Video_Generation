"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function DashboardError({ reset }: { reset: () => void }) {
  const router = useRouter();
  return (
    <AuthFrame>
      <div className="not-found">
        <div className="eyebrow">Let’s try that again</div>
        <h1>Your studio couldn’t load.</h1>
        <p>
          We couldn’t retrieve your dashboard. Your saved content has not been
          changed.
        </p>
        <button className="primary-button" onClick={reset}>
          Try again
        </button>
        <button
          className="text-link"
          style={{ marginTop: 20 }}
          onClick={async () => {
            const result = await authClient.signOut();
            if (!result.error) {
              router.replace("/sign-in");
              router.refresh();
            }
          }}
        >
          Sign out
        </button>
      </div>
    </AuthFrame>
  );
}
