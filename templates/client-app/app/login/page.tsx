import clientConfig from "@/client.config";
import LoginForm from "./LoginForm";

/**
 * `?step=mfa` is set when a guard bounced a half-authenticated session back
 * here — the password is already accepted, only the second factor is missing.
 * Reading it server-side avoids needing a Suspense boundary for
 * useSearchParams.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step } = await searchParams;
  return <LoginForm
      initialStep={step === "mfa" ? "mfa" : "password"}
      brandTitle={clientConfig.branding.adminTitle}
    />;
}
