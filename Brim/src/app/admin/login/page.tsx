import { AuthPage } from "@/components/forms/form-bits";
import { StaffLoginForm } from "./staff-login-form";

export default function StaffLoginPage() {
  return (
    <AuthPage eyebrow="Brim staff" title="Staff login">
      <p className="muted -mt-4 mb-6 text-[15px]">For Brim employees who onboard and manage organizations.</p>
      <StaffLoginForm />
    </AuthPage>
  );
}
