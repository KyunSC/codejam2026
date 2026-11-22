import { useState } from "react";
import { call, del, get, post, useLoad } from "../api";
import { useUser } from "../session";
import { ApiForm, str } from "../components/ApiForm";
import { Card, Field, PageTitle, Table, Td, btn, btnDanger, dateTime, input } from "../components/ui";

type Token = { token_id: string; name: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

// The signed-in user's account: change your password, and the tokens your agents sign in with.
export function Account() {
  const user = useUser();
  const tokens = useLoad(() => get<Token[]>("/api/me/tokens"), "");
  const [created, setCreated] = useState<string | null>(null);
  const createToken = async (fd: FormData) => {
    const r = await post<{ token: string }>("/api/me/tokens", { name: str(fd, "name") ?? "" });
    setCreated(r.token);
    tokens.reload();
  };
  const revoke = (id: string) => async () => {
    await del(`/api/me/tokens/${id}`);
    tokens.reload();
  };
  const change = async (fd: FormData) => {
    const next = str(fd, "new_password") ?? "";
    if (next !== str(fd, "confirm_password")) throw new Error("The new passwords do not match.");
    await call("PUT", "/api/me/password", { current_password: str(fd, "current_password") ?? "", new_password: next });
    return "Password changed.";
  };
  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle sub={user.email}>{user.full_name}</PageTitle>
      <Card title="Change password">
        <ApiForm submit={change} className="space-y-3">
          <Field label="Current password"><input name="current_password" type="password" required autoComplete="current-password" className={input} /></Field>
          <Field label="New password"><input name="new_password" type="password" required minLength={8} autoComplete="new-password" className={input} /></Field>
          <Field label="New password again"><input name="confirm_password" type="password" required minLength={8} autoComplete="new-password" className={input} /></Field>
          <button className={btn}>Change password</button>
        </ApiForm>
      </Card>
      {user.organization_id && (
        <Card title="Agent access">
          <p className="mb-3 text-sm muted">
            A token lets your AI agent work in Brim AP through MCP, as you and with your role. Every action it takes is marked &quot;agent&quot; in the audit log.
          </p>
          {created && (
            <div className="form-ok mb-4 space-y-2">
              <p>Copy this token now; it is not shown again.</p>
              <code className="block break-all rounded bg-surface-2 p-2 font-mono text-xs">{created}</code>
              <p className="text-xs font-normal">Claude Code:</p>
              <code className="block break-all rounded bg-surface-2 p-2 font-mono text-xs">{`claude mcp add --transport http brim-ap ${location.origin}/mcp --header "Authorization: Bearer ${created}"`}</code>
            </div>
          )}
          <ApiForm reset submit={createToken} className="mb-4 flex items-end gap-2">
            <Field label="Token name"><input name="name" placeholder="e.g. Claude on my laptop" className={input} required /></Field>
            <button className={btn}>Create token</button>
          </ApiForm>
          <Table head={["Name", "Created", "Last used", ""]} empty="No tokens yet.">
            {(tokens.data ?? []).map((t) => (
              <tr key={t.token_id}>
                <Td>{t.name}</Td>
                <Td className="text-xs">{dateTime(t.created_at)}</Td>
                <Td className="text-xs">{t.revoked_at ? `revoked ${dateTime(t.revoked_at)}` : dateTime(t.last_used_at)}</Td>
                <Td>{!t.revoked_at && <ApiForm inline submit={revoke(t.token_id)}><button className={btnDanger}>Revoke</button></ApiForm>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
