import { NavLink, Outlet } from "react-router-dom";
import {
  Bell,
  Palette,
  Plug,
  FileBarChart,
  Link2,
  UserRound,
} from "lucide-react";

const pages = [
  { to: "/settings/appearance", label: "Appearance", icon: Palette },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/integrations", label: "Integrations", icon: Plug },
  { to: "/settings/reports", label: "Reports", icon: FileBarChart },
  { to: "/settings/shares", label: "Share links", icon: Link2 },
  { to: "/settings/account", label: "Account", icon: UserRound },
];

export default function SettingsLayout() {
  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">Settings</h1>
      <p className="mt-1 text-sm text-ink-500">Make SheetWatch yours.</p>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:gap-10">
        <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col">
          {pages.map((p) => (
            <NavLink
              key={p.to}
              to={p.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-teal-soft text-teal-600"
                    : "text-ink-500 hover:bg-secondary hover:text-ink-900"
                }`
              }
            >
              <p.icon className="h-4 w-4" />
              {p.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 lg:max-w-3xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
