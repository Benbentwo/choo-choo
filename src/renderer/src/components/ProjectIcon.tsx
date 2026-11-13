import {
  Atom,
  Beaker,
  BookOpen,
  Bot,
  Box,
  Brain,
  Briefcase,
  Bug,
  Building2,
  Cloud,
  Code,
  Compass,
  Cpu,
  CreditCard,
  Database,
  Flag,
  Flame,
  Gauge,
  Gem,
  Globe,
  Heart,
  Layers,
  Layout,
  Leaf,
  Lightbulb,
  Lock,
  Mail,
  Map,
  MessageSquare,
  Moon,
  Music,
  Package,
  Palette,
  PenTool,
  Puzzle,
  Rocket,
  Search,
  Server,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Target,
  Terminal,
  TrainFront,
  Users,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { RepoGroup } from '@shared/types'
import { PROJECT_COLORS } from '@shared/projects'
import { IconOrchestrator } from '../icons'

/** Icons a project can pick, by name. Lucide icons (ISC license). */
export const PROJECT_ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  sparkles: Sparkles,
  zap: Zap,
  flame: Flame,
  star: Star,
  target: Target,
  flag: Flag,
  compass: Compass,
  map: Map,
  globe: Globe,
  cloud: Cloud,
  server: Server,
  database: Database,
  cpu: Cpu,
  terminal: Terminal,
  code: Code,
  layers: Layers,
  layout: Layout,
  box: Box,
  package: Package,
  puzzle: Puzzle,
  wrench: Wrench,
  bug: Bug,
  shield: Shield,
  lock: Lock,
  gauge: Gauge,
  beaker: Beaker,
  atom: Atom,
  brain: Brain,
  bot: Bot,
  lightbulb: Lightbulb,
  palette: Palette,
  'pen-tool': PenTool,
  'book-open': BookOpen,
  'message-square': MessageSquare,
  mail: Mail,
  users: Users,
  briefcase: Briefcase,
  building: Building2,
  'shopping-cart': ShoppingCart,
  'credit-card': CreditCard,
  smartphone: Smartphone,
  search: Search,
  heart: Heart,
  gem: Gem,
  leaf: Leaf,
  sun: Sun,
  moon: Moon,
  music: Music,
  train: TrainFront
}

/** A project's icon in its color. Projects that never picked one keep the orchestrator mark in the accent color. */
export function ProjectIcon({ group, size = 14, className = '' }: { group?: Pick<RepoGroup, 'icon' | 'color'>; size?: number; className?: string }) {
  const Icon = group?.icon ? PROJECT_ICONS[group.icon] : undefined
  const color = group?.color ? (PROJECT_COLORS.find((c) => c.id === group.color)?.hex ?? group.color) : undefined
  if (!Icon) return <IconOrchestrator width={size} height={size} className={`shrink-0 ${color ? '' : 'text-accent'} ${className}`} style={color ? { color } : undefined} />
  return <Icon size={size} strokeWidth={1.9} className={`shrink-0 ${color ? '' : 'text-accent'} ${className}`} style={color ? { color } : undefined} />
}

/** Icon grid and color swatches for the project modal. */
export function ProjectIconPicker({ icon, color, onChange }: { icon?: string; color?: string; onChange: (v: { icon?: string; color?: string }) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PROJECT_COLORS.map((c) => (
          <button
            key={c.id}
            title={c.label}
            onClick={() => onChange({ icon, color: c.id })}
            className={`h-5 w-5 rounded-full border-2 ${color === c.id || (!color && c.id === 'accent') ? 'border-fg' : 'border-transparent'}`}
            style={{ background: c.hex }}
          />
        ))}
      </div>
      <div className="grid max-h-36 grid-cols-10 gap-1 overflow-y-auto rounded-md border border-line p-1.5">
        {Object.entries(PROJECT_ICONS).map(([id, Icon]) => (
          <button
            key={id}
            title={id.replace(/-/g, ' ')}
            onClick={() => onChange({ icon: id, color })}
            className={`flex h-7 items-center justify-center rounded ${icon === id ? 'bg-raised ring-1 ring-accent' : 'hover:bg-hover'}`}
          >
            <Icon size={15} strokeWidth={1.9} style={{ color: PROJECT_COLORS.find((c) => c.id === color)?.hex }} className={color ? '' : 'text-accent'} />
          </button>
        ))}
      </div>
    </div>
  )
}
