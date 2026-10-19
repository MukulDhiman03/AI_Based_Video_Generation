"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  AtSign,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

type Values = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  invite: string;
};
type Errors = Partial<Record<keyof Values, string>>;

function Field({
  label,
  id,
  icon: Icon,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  icon: LucideIcon;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="field-group">
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
      </div>
      <div className="field-shell">
        <Icon className="field-icon" aria-hidden="true" />
        <input
          {...props}
          id={id}
          name={id}
          className="text-input"
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-help` : undefined}
        />
      </div>
      {(error || hint) && (
        <div id={`${id}-help`} className={error ? "field-error" : "field-hint"}>
          {error || hint}
        </div>
      )}
    </div>
  );
}

function PasswordField({
  label,
  id,
  value,
  onChange,
  error,
  hint,
  action,
  autoComplete,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field-group">
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <div className="field-shell">
        <LockKeyhole className="field-icon" aria-hidden="true" />
        <input
          id={id}
          name={id}
          className="text-input"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            id === "confirmPassword"
              ? "Re-enter your password"
              : autoComplete === "new-password"
                ? "Create a strong password"
                : "Enter your password"
          }
          autoComplete={autoComplete}
          maxLength={128}
          required
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-help` : undefined}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {(error || hint) && (
        <div id={`${id}-help`} className={error ? "field-error" : "field-hint"}>
          {error || hint}
        </div>
      )}
    </div>
  );
}

function readableError(status: number, code?: string) {
  if (status === 429)
    return "A few too many attempts. Please wait a minute and try again.";
  if (code === "INVALID_INVITATION")
    return "This invitation is invalid, expired, already used, or belongs to a different email. Check the code or leave it blank to sign up without one.";
  if (code === "INVALID_EMAIL_OR_PASSWORD")
    return "That email and password don’t match. Please check them and try again.";
  if (code?.includes("USER_ALREADY_EXISTS"))
    return "An account already exists for this email. Please sign in instead.";
  if (code?.includes("PASSWORD_TOO_SHORT"))
    return "Choose a password with at least 12 characters.";
  if (status >= 500)
    return "We couldn’t connect right now. Please try again shortly.";
  return "We couldn’t complete that request. Check your details and try again.";
}

export function AuthForm({
  signup = false,
  initialInvite = "",
}: {
  signup?: boolean;
  initialInvite?: string;
}) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [completedUser, setCompletedUser] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [values, setValues] = useState<Values>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    invite: initialInvite,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [recoveryHelp, setRecoveryHelp] = useState(false);
  const user = completedUser || session?.user;
  useEffect(() => {
    if (user) {
      router.replace("/home");
      router.refresh();
    }
  }, [user, router]);

  function update(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const next: Errors = {};
    if (!z.email().safeParse(values.email.trim()).success)
      next.email = "Enter a valid email address.";
    if (!values.password) next.password = "Enter your password.";
    if (signup) {
      if (values.name.trim().length < 2)
        next.name = "Enter your full name (at least 2 characters).";
      if (values.password.length < 12)
        next.password = "Use at least 12 characters for your password.";
      if (values.confirmPassword !== values.password || !values.confirmPassword)
        next.confirmPassword = "Your passwords need to match.";
      if (
        values.invite.trim() &&
        !/^[A-Za-z0-9_-]{43}$/.test(values.invite.trim())
      )
        next.invite =
          "Check your invitation code, or leave it blank to continue without one.";
    }
    setErrors(next);
    if (Object.keys(next).length) {
      const order: (keyof Values)[] = signup
        ? ["invite", "name", "email", "password", "confirmPassword"]
        : ["email", "password"];
      const first = order.find((field) => next[field]);
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = signup
        ? await authClient.signUp.email(
            {
              name: values.name.trim(),
              email: values.email.trim(),
              password: values.password,
            },
            values.invite.trim()
              ? { headers: { "x-vidsutra-invite": values.invite.trim() } }
              : undefined,
          )
        : await authClient.signIn.email({
            email: values.email.trim(),
            password: values.password,
            rememberMe: remember,
          });
      if (result.error) {
        setMessage(readableError(result.error.status, result.error.code));
      } else if (result.data?.user) {
        setCompletedUser({
          name: result.data.user.name,
          email: result.data.user.email,
        });
        setValues((current) => ({
          ...current,
          password: "",
          confirmPassword: "",
          invite: "",
        }));
      } else {
        setMessage(
          "Your session could not be confirmed. Please try signing in.",
        );
      }
    } catch {
      setMessage(
        "We couldn’t reach VidSutra. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (user)
    return (
      <section className="success-state" role="status">
        <div className="success-icon">
          <LoaderCircle className="spinner" size={26} />
        </div>
        <h1>Opening your studio…</h1>
        <p>You’re signed in. Taking you to your dashboard.</p>
      </section>
    );

  return (
    <>
      <header className="auth-intro">
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          {signup ? "Your space to create" : "Welcome to your studio"}
        </div>
        <h1>{signup ? "Complete your studio setup" : "Sign in to VidSutra"}</h1>
        <p>
          {signup
            ? "A little curiosity. A whole new way to explain it. Let’s get your account ready."
            : "A space for your ideas, and the stories they’ll become."}
        </p>
      </header>
      {signup && (
        <div className="invitation-hint">
          <KeyRound aria-hidden="true" />
          <span>Everyone is welcome. An invitation code is optional.</span>
        </div>
      )}
      {message && (
        <div className="notice" role="alert">
          <TriangleAlert aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}
      <form
        onSubmit={submit}
        className="auth-form"
        noValidate
        aria-label={signup ? "Create your account" : "Sign in"}
        aria-busy={busy}
      >
        {signup && (
          <Field
            id="invite"
            label="Invitation code (optional)"
            icon={KeyRound}
            value={values.invite}
            onChange={(e) => update("invite", e.target.value)}
            error={errors.invite}
            placeholder="Your invitation code"
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            hint={
              initialInvite
                ? "Your invite link added this code. You can clear it to sign up without one."
                : "No code? Leave this blank and create your account."
            }
          />
        )}
        {signup && (
          <Field
            id="name"
            label="Full name"
            icon={UserRound}
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            error={errors.name}
            placeholder="Your name"
            autoComplete="name"
            maxLength={100}
            required
          />
        )}
        <Field
          id="email"
          label="Email address"
          icon={AtSign}
          type="email"
          inputMode="email"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          error={errors.email}
          placeholder="you@example.com"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          required
        />
        <PasswordField
          id="password"
          label="Password"
          value={values.password}
          onChange={(v) => update("password", v)}
          error={errors.password}
          autoComplete={signup ? "new-password" : "current-password"}
          hint={
            signup ? (
              <span
                className={
                  values.password.length >= 12 ? "field-hint is-valid" : ""
                }
              >
                {values.password.length >= 12 && <Check size={12} />}At least 12
                characters
              </span>
            ) : undefined
          }
          action={
            !signup && (
              <button
                type="button"
                className="text-link"
                aria-expanded={recoveryHelp}
                aria-controls="recovery-help"
                onClick={() => setRecoveryHelp(!recoveryHelp)}
              >
                Forgot password?
              </button>
            )
          }
        />
        {recoveryHelp && !signup && (
          <p id="recovery-help" className="recovery-note" role="status">
            Password recovery isn’t available yet. Please contact the VidSutra
            team for help with account access.
          </p>
        )}
        {signup && (
          <PasswordField
            id="confirmPassword"
            label="Confirm password"
            value={values.confirmPassword}
            onChange={(v) => update("confirmPassword", v)}
            error={errors.confirmPassword}
            autoComplete="new-password"
            hint={
              values.confirmPassword &&
              values.confirmPassword === values.password ? (
                <span className="field-hint is-valid">
                  <Check size={12} />
                  Passwords match
                </span>
              ) : undefined
            }
          />
        )}
        {!signup && (
          <div className="form-options">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember me
            </label>
            <span className="quiet-label">
              <LockKeyhole size={11} />
              Email & password
            </span>
          </div>
        )}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="spinner" aria-hidden="true" />
              {signup ? "Creating your account…" : "Signing you in…"}
            </>
          ) : (
            <>
              {signup ? "Create account" : "Sign in"}
              <ArrowRight aria-hidden="true" />
            </>
          )}
        </button>
      </form>
      {signup ? (
        <>
          <p className="signup-caption">
            <ShieldCheck aria-hidden="true" />
            Free beta. No payment details needed.
          </p>
          <div className="form-divider" />
          <p className="auth-switch">
            Already have an account?<Link href="/sign-in">Sign in</Link>
          </p>
        </>
      ) : (
        <aside className="invite-note">
          <div className="note-label">
            <ShieldCheck aria-hidden="true" />A little circle of creators
          </div>
          <p>
            VidSutra is in beta. Create your account and start your next
            chapter. No invitation needed.
          </p>
          <Link href="/sign-up">
            Create your account
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </aside>
      )}
      {signup && (
        <p className="auth-switch" style={{ fontSize: 11, marginTop: 17 }}>
          You can sign up with or without an invitation code.
        </p>
      )}
    </>
  );
}
