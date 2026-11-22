import { PageTitle } from "@/components/ui";
import { SubTabs } from "@/components/NavTabs";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <SubTabs
        items={[
          { href: "/settings/users", label: "Users", match: "/settings/users" },
          { href: "/settings/policies", label: "Approval policies", match: "/settings/policies" },
        ]}
      />
      {children}
    </div>
  );
}
