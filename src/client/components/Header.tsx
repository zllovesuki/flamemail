import { Flame, Inbox, Info, Plus, Shield } from "lucide-react";
import { Link, NavLink } from "react-router-dom";

interface HeaderProps {
  sessionCount?: number;
}

export function Header({ sessionCount = 0 }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
          <span className="inline-grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-flame-500 to-flame-600 shadow-lg shadow-flame-500/20">
            <Flame className="h-5 w-5 text-white" />
          </span>
          <span className="hidden sm:block">
            <strong className="block text-sm font-semibold text-zinc-100">flamemail</strong>
            <small className="block text-xs text-zinc-500">Disposable inboxes on Cloudflare</small>
          </span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Primary">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-flame-500/10 text-flame-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`
            }
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Create</span>
          </NavLink>
          {sessionCount > 0 ? (
            <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-500">
              <Inbox className="h-3.5 w-3.5" />
              <span className="text-xs">{sessionCount}</span>
            </span>
          ) : null}
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-flame-500/10 text-flame-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`
            }
          >
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">About</span>
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-flame-500/10 text-flame-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`
            }
          >
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Admin</span>
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
