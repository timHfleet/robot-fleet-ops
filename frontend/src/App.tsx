import { Routes, Route, NavLink } from 'react-router-dom'
import './appTheme.css'
import {
  Gauge,
  CheckCircle2,
  Zap,
  Radio,
  DollarSign,
  MapPinned,
  Siren,
  Users,
  Ticket,
  Wrench,
  ClipboardList,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Quality from './pages/Quality'
import Throughput from './pages/Throughput'
import Uptime from './pages/Uptime'
import Efficiency from './pages/Efficiency'
import Coverage from './pages/Coverage'
import Incidents from './pages/Incidents'
import Tickets from './pages/Tickets'
import Operators from './pages/Operators'
import Maintenance from './pages/Maintenance'
import ShiftHandoff from './pages/ShiftHandoff'
import Capacity from './pages/Capacity'
import { RangePicker } from './pages/ui/range'
import AddDataDialog from './pages/ui/add-data/AddDataDialog'
import SearchDataDialog from './pages/ui/search-data/SearchDataDialog'
import ThemeToggle from './pages/ui/ThemeToggle'
import { cn } from './lib/shadcn/utils'

type NavItem = { to: string; label: string; icon: LucideIcon }

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/quality', label: 'Quality', icon: CheckCircle2 },
  { to: '/throughput', label: 'Throughput', icon: Zap },
  { to: '/uptime', label: 'Uptime and Downtime', icon: Radio },
  { to: '/efficiency', label: 'Efficiency', icon: DollarSign },
  { to: '/coverage', label: 'Coverage', icon: MapPinned },
  { to: '/incidents', label: 'Incidents', icon: Siren },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/operators', label: 'Ops/Leaderboard', icon: Users },
]

// Ops tools: turn the metrics into decisions.
const TOOLS: NavItem[] = [
  { to: '/maintenance', label: 'Maintenance Alerts', icon: Wrench },
  { to: '/handoff', label: 'Shift Handoff', icon: ClipboardList },
  { to: '/capacity', label: 'Capacity Planner', icon: SlidersHorizontal },
]

function SideLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </NavLink>
  )
}

export default function App() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-56 shrink-0 border-r border-border bg-card md:block print:hidden">
        <div className="p-5">
          <h1 className="text-sm font-semibold leading-tight">Ops Metrics</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Robot data-collection fleet</p>
        </div>
        <nav className="space-y-1 px-3">
          {NAV.map((item) => (
            <SideLink key={item.to} {...item} />
          ))}
        </nav>
        <div className="mx-3 mt-5 border-t border-border pt-4">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ops tools</p>
          <nav className="space-y-1">
            {TOOLS.map((item) => (
              <SideLink key={item.to} {...item} />
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/95 px-6 py-3 backdrop-blur print:hidden">
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {[...NAV, ...TOOLS].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs',
                    isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden md:block text-sm text-muted-foreground">Operational metrics · robot episode collection</div>
          <div className="flex items-center gap-3">
            <SearchDataDialog />
            <AddDataDialog />
            <ThemeToggle />
            <RangePicker />
          </div>
        </header>

        <main className="flex-1 p-6 print:p-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/quality" element={<Quality />} />
            <Route path="/throughput" element={<Throughput />} />
            <Route path="/uptime" element={<Uptime />} />
            <Route path="/efficiency" element={<Efficiency />} />
            <Route path="/coverage" element={<Coverage />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/operators" element={<Operators />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/handoff" element={<ShiftHandoff />} />
            <Route path="/capacity" element={<Capacity />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
