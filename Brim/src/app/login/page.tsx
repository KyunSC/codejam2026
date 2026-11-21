import Link from "next/link";
import { AuthPage } from "@/components/forms/form-bits";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthPage eyebrow="Brim accounts payable" title="Log in">
      <LoginForm />
      <p className="muted mt-6 text-[15px]">
        No account yet?{" "}
        <Link href="/signup" className="font-semibold text-text underline underline-offset-4">
          Request access
        </Link>{" "}
        from your organization.
      </p>
    </AuthPage>
  );
}
