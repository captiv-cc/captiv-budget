// ════════════════════════════════════════════════════════════════════════════
// notifDisplay — icônes/couleurs par type de notification + temps relatif
// ════════════════════════════════════════════════════════════════════════════
// Partagé entre la cloche (NotificationsBell) et le widget de la homepage.

import { Bell, Check, X, Eye, Clock, AlertTriangle, Calendar, Pencil, MessageCircle, BadgeCheck } from 'lucide-react'

export const NOTIF_TYPE_STYLE = {
  devis_consulte: { icon: Eye, color: 'var(--blue)' },
  devis_accepte: { icon: Check, color: 'var(--green)' },
  devis_refuse: { icon: X, color: 'var(--red)' },
  devis_relance: { icon: Clock, color: 'var(--orange)' },
  devis_expire: { icon: AlertTriangle, color: 'var(--orange)' },
  devis_modifie: { icon: Pencil, color: 'var(--purple, #a855f7)' },
  creneau_assigne: { icon: Calendar, color: 'var(--blue)' },
  creneau_modifie: { icon: Calendar, color: 'var(--orange)' },
  creneau_annule: { icon: Calendar, color: 'var(--red)' },
  plan_commentaire: { icon: MessageCircle, color: '#facc15' },
  plan_valide: { icon: BadgeCheck, color: 'var(--green)' },
}

export const NOTIF_FALLBACK_STYLE = { icon: Bell, color: 'var(--txt-3)' }

export function notifRelTime(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'à l’instant'
  const m = Math.floor(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'hier'
  if (d < 7) return `il y a ${d} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
