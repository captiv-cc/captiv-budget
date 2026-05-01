/**
 * Page admin — Paramètres (Chantier 4D)
 *
 * Container avec onglets :
 *   - Templates métiers (4D) — édition des profils de permissions
 *   - (à venir) Outils, Organisation, etc.
 *
 * Accessible uniquement aux admins (garde au niveau route).
 */

import { useState } from 'react'
import { Shield, Wrench, Building2, CalendarClock } from 'lucide-react'
import TemplatesMetiersTab from './TemplatesMetiersTab'
import EventTypesTab from './EventTypesTab'
import OrganisationTab from './OrganisationTab'

function Placeholder({ title }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center">
      <p className="text-2xl mb-2">🚧</p>
      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
        {title}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
        En cours de construction
      </p>
    </div>
  )
}

const TABS = [
  { key: 'metiers', label: 'Templates métiers', icon: Shield, component: TemplatesMetiersTab },
  { key: 'event_types', label: "Types d'événements", icon: CalendarClock, component: EventTypesTab },
  // placeholders pour plus tard
  {
    key: 'outils',
    label: 'Outils',
    icon: Wrench,
    component: () => <Placeholder title="Catalogue d'outils" />,
  },
  { key: 'org', label: 'Organisation', icon: Building2, component: OrganisationTab },
]

export default function Settings() {
  const [activeTab, setActiveTab] = useState('metiers')
  const ActiveComponent = TABS.find((t) => t.key === activeTab)?.component || (() => null)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--txt)' }}>
          Paramètres
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--txt-3)' }}>
          Administration de l&apos;organisation et des accès prestataires
        </p>
      </div>

      {/* Tabs nav */}
      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: 'var(--brd)' }}>
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative -mb-px"
              style={{
                color: isActive ? 'var(--blue)' : 'var(--txt-2)',
                borderBottom: isActive ? '2px solid var(--blue)' : '2px solid transparent',
              }}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <ActiveComponent />
    </div>
  )
}
