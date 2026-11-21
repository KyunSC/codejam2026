import Link from "next/link";
import { AuthPage } from "@/components/forms/form-bits";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthPage eyebrow="New account" title="Request access">
      <p className="muted -mt-4 mb-6 text-[15px]">
        Your request goes to your organization&rsquo;s administrators. You can log in once one of them approves it.
      </p>
      <SignupForm />
      <p className="muted mt-6 text-[15px]">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-text underline underline-offset-4">
          Log in
        </Link>
      </p>
    </AuthPage>
  );
}
