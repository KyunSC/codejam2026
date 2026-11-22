import { useEffect } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { can } from "@/lib/authz";
import type { Organization } from "@/services/organization.service";
import { del, get, useLoad } from "./api";
import { org, useSession } from "./session";
import { NavTabs, SubTabs } from "./components/NavTabs";
import { NotFound, PageTitle } from "./components/ui";
import { Home } from "./pages/Home";
import { EmployeeLogin, Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Invoices } from "./pages/Invoices";
import { InvoiceForm, InvoiceUpload } from "./pages/InvoiceIntake";
import { Invoice } from "./pages/Invoice";
import { Payment, Payments } from "./pages/Payments";
import { NewVendor, Vendor, Vendors } from "./pages/Vendors";
import { PoliciesSettings, UsersSettings } from "./pages/Settings";
import { Audit } from "./pages/Audit";
import { Organization as OrganizationPage, Organizations } from "./pages/Organizations";
import { CustomizeButton, EditModeProvider } from "./customize/EditMode";
import { EditBar } from "./customize/EditBar";

export function App() {
  const { pathname } = useLocation();
  // a new screen opens at the top; filters and paging (query string only) keep the scroll position
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/employee-login" element={<EmployeeLogin />} />
      <Route element={<WorkspaceLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/upload" element={<InvoiceUpload />} />
        <Route path="/invoices/form" element={<InvoiceForm />} />
        <Route path="/invoices/:id" element={<Invoice />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/payments/:id" element={<Payment />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/vendors/new" element={<NewVendor />} />
        <Route path="/vendors/:id" element={<Vendor />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/settings/users" replace />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="policies" element={<PoliciesSettings />} />
        </Route>
        <Route path="/audit" element={<Audit />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route element={<BrimLayout />}>
        <Route path="/organizations" element={<Organizations />} />
        <Route path="/organizations/:id" element={<OrganizationPage />} />
      </Route>
    </Routes>
  );
}

function LogoutButton() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  // leave the signed-in layout first, so its signed-out redirect to a login page never runs
  const logout = async () => {
    await del("/api/session");
    navigate("/");
    await refresh();
  };
  return <button className="btn btn--ghost btn--sm" onClick={logout}>Log out</button>;
}

// An organization user's workspace: organization name, the user, and the tabs their role may open.
function WorkspaceLayout() {
  const { user, loading } = useSession();
  const orgLoad = useLoad(() => (user ? get<Organization>(org(user)) : Promise.resolve(null)), user?.user_id ?? "");
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "brim_employee") return <Navigate to="/organizations" replace />;
  const tabs = [
    { href: "/dashboard", label: "Dashboard", match: "/dashboard" },
    { href: "/invoices", label: "Invoices", match: "/invoices" },
    ...(can(user, "payment.view") ? [{ href: "/payments", label: "Payments", match: "/payments" }] : []),
    ...(can(user, "vendor.view") ? [{ href: "/vendors", label: "Vendors", match: "/vendors" }] : []),
    ...(can(user, "audit.view") ? [{ href: "/audit", label: "Audit", match: "/audit" }] : []),
    ...(can(user, "users.manage") ? [{ href: "/settings/users", label: "Settings", match: "/settings" }] : []),
  ];
  return (
    <EditModeProvider>
    <div className="flex min-h-screen flex-col">
      <header className="z-10 border-b-2 border-border bg-bg sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:px-5">
          <Link to="/dashboard" className="flex items-baseline gap-2 no-underline">
            <span className="text-[17px] font-bold">{orgLoad.data?.legal_name}</span>
            <span className="muted text-sm">Accounts payable</span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold">{user.full_name}</span>
            <span className="chip chip--gray">{user.role.replace(/_/g, " ")}</span>
            <CustomizeButton />
            <LogoutButton />
          </div>
          <div className="basis-full">
            <NavTabs items={tabs} />
          </div>
        </div>
        <EditBar workspace />
      </header>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 sm:px-5">
        <Outlet />
      </main>
    </div>
    </EditModeProvider>
  );
}

function SettingsLayout() {
  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <SubTabs
        items={[
          { href: "/settings/users", label: "Users", match: "/settings/users" },
          { href: "/settings/policies", label: "Approval policies", match: "/settings/policies" },
        ]}
      />
      <Outlet />
    </div>
  );
}

// Brim operations: the organizations.
function BrimLayout() {
  const { user, loading } = useSession();
  if (loading) return null;
  if (!user) return <Navigate to="/employee-login" replace />;
  if (user.role !== "brim_employee") return <Navigate to="/dashboard" replace />;
  return (
    <EditModeProvider>
    <div className="flex min-h-screen flex-col">
      <header className="z-10 border-b border-rule bg-bg sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3.5 sm:px-5">
          <Link to="/organizations" className="flex items-baseline gap-2 no-underline">
            <span className="text-[17px] font-bold">Brim</span>
            <span className="muted text-sm">Operations</span>
          </Link>
          <nav className="text-sm font-bold"><Link to="/organizations" className="no-underline">Organizations</Link></nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="font-bold">{user.full_name}</span>
            <CustomizeButton />
            <LogoutButton />
          </div>
        </div>
        <EditBar workspace={false} />
      </header>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 sm:px-5">
        <Outlet />
      </main>
    </div>
    </EditModeProvider>
  );
}
