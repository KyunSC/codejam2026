import { useEffect } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { can } from "@/lib/authz";
import type { Organization } from "@/services/organization.service";
import type { User } from "@/lib/types";
import { del, get, useLoad } from "./api";
import { org, useSession, useUser } from "./session";
import { SubTabs, WorkspaceTabs } from "./components/NavTabs";
import { NotFound, PageTitle } from "./components/ui";
import { Home } from "./pages/Home";
import { EmployeeLogin, Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Invoices } from "./pages/Invoices";
import { InvoiceForm, InvoiceUpload } from "./pages/InvoiceIntake";
import { Invoice } from "./pages/Invoice";
import { PurchaseOrder, PurchaseOrders } from "./pages/PurchaseOrders";
import { Payment, Payments } from "./pages/Payments";
import { NewVendor, Vendor, Vendors } from "./pages/Vendors";
import { PoliciesSettings, UsersSettings } from "./pages/Settings";
import { Audit } from "./pages/Audit";
import { Account } from "./pages/Account";
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
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrder />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/payments/:id" element={<Payment />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/vendors/new" element={<NewVendor />} />
        <Route path="/vendors/:id" element={<Vendor />} />
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<SettingsHome />} />
          <Route path="users" element={<UsersSettings />} />
          <Route path="policies" element={<PoliciesSettings />} />
          <Route path="audit" element={<Audit />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="/account" element={<AccountLayout />}>
        <Route index element={<Account />} />
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
// Scrolls to the section a link points to (#id), waiting for the page to load it.
function ScrollToSection() {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(hash.slice(1));
      if (el || ++tries > 40) {
        clearInterval(timer);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
    return () => clearInterval(timer);
  }, [pathname, search, hash]);
  return null;
}

function WorkspaceLayout() {
  const { user, loading } = useSession();
  const orgLoad = useLoad(() => (user ? get<Organization>(org(user)) : Promise.resolve(null)), user?.user_id ?? "");
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "brim_employee") return <Navigate to="/organizations" replace />;
  // The tabs come from the user's workspace preferences (WorkspaceTabs, TABS in src/lib/preferences.ts).
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
            <WorkspaceTabs />
          </div>
        </div>
        <EditBar workspace />
      </header>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 sm:px-5">
        <ScrollToSection />
        <Outlet />
      </main>
    </div>
    </EditModeProvider>
  );
}

// The settings pages the user's role may open.
const settingsTabs = (user: User) => [
  ...(can(user, "users.manage") ? [{ href: "/settings/users", label: "Users", match: "/settings/users" }] : []),
  ...(can(user, "policies.manage") ? [{ href: "/settings/policies", label: "Approval policies", match: "/settings/policies" }] : []),
  ...(can(user, "audit.view") ? [{ href: "/settings/audit", label: "Audit", match: "/settings/audit" }] : []),
];

function SettingsLayout() {
  const user = useUser();
  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <SubTabs items={settingsTabs(user)} />
      <Outlet />
    </div>
  );
}

// /settings opens the first settings page the user may see.
function SettingsHome() {
  const first = settingsTabs(useUser())[0];
  return first ? <Navigate to={first.href} replace /> : <NotFound />;
}

// The account page sits in the header of whichever side the user signs in to.
function AccountLayout() {
  const { user, loading } = useSession();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return user.role === "brim_employee" ? <BrimLayout /> : <WorkspaceLayout />;
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
          <nav className="flex gap-4 text-sm font-bold">
            <Link to="/organizations" className="no-underline">Organizations</Link>
            <Link to="/account" className="no-underline">Account</Link>
          </nav>
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
