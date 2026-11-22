import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { login } from "../actions";
import { btn, input } from "@/components/ui";

export default function EmployeeLoginPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <Link href="/" className="text-sm muted hover:underline">← brim</Link>
      <h1 className="mt-4 text-2xl font-semibold">Brim employee login</h1>
      <ActionForm action={login} className="mt-6 space-y-3">
        <input type="hidden" name="brim" value="1" />
        <input name="email" type="email" required defaultValue="ops@brim.example" className={input} />
        <button className={btn}>Log in</button>
      </ActionForm>
    </div>
  );
}
