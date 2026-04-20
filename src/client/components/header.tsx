import { Flame, Inbox, Info, Shield } from "lucide-react";
import { Link, NavLink } from "react-router-dom";

interface HeaderProps {
  sessionCount?: number;
}

export function Header({ sessionCount = 0 }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-900/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="group flex items-center gap-3 transition-opacity hover:opacity-80">
          <span className="inline-grid h-9 w-9 place-items-center">
            <Flame
              className="h-6 w-6 text-accent-400 transition-transform duration-200 group-hover:-rotate-6"
              strokeWidth={2}
              aria-hidden="true"
            />
          </span>
          <span className="hidden sm:block">
            <strong className="block text-sm font-semibold text-zinc-100">flamemail</strong>
            <small className="block text-xs text-zinc-400">Disposable inboxes on Cloudflare</small>
          </span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Primary">
          {sessionCount > 0 ? (
            <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-400">
              <Inbox className="h-3.5 w-3.5" />
              <span className="text-xs">{sessionCount}</span>
            </span>
          ) : null}
          <NavLink
            to="/about"
            aria-label="About"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? "bg-accent-500/10 text-accent-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`
            }
          >
            <Info className="h-3.5 w-3.5" />
            <span>About</span>
          </NavLink>
          <NavLink
            to="/admin"
            aria-label="Admin"
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? "bg-accent-500/10 text-accent-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`
            }
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Admin</span>
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
