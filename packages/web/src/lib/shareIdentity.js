// ════════════════════════════════════════════════════════════════════════════
// shareIdentity — « qui suis-je » sur les pages publiques d'un projet
// ════════════════════════════════════════════════════════════════════════════
//
// Un cadreur qui a dit une fois qui il était sur la logistique ne doit pas
// avoir à le redire sur le déroulé. On mémorise donc son projet_membres.id
// PAR PROJET (et non par token) : les liens de partage diffèrent d'un module
// à l'autre, le projet, lui, est le même.
//
// localStorage seulement — aucune donnée ne remonte au serveur, et un lien
// transmis à quelqu'un d'autre n'emporte pas l'identité du premier lecteur.
// ════════════════════════════════════════════════════════════════════════════

const KEY_PREFIX = 'captiv.share.moi.'

function keyFor(projectId) {
  return projectId ? KEY_PREFIX + projectId : null
}

/** membre_id mémorisé pour ce projet, ou null. */
export function readShareIdentity(projectId) {
  const key = keyFor(projectId)
  if (!key || typeof localStorage === 'undefined') return null
  return localStorage.getItem(key) || null
}

/** Mémorise (ou oublie si membreId est vide) l'identité pour ce projet. */
export function writeShareIdentity(projectId, membreId) {
  const key = keyFor(projectId)
  if (!key || typeof localStorage === 'undefined') return
  if (membreId) localStorage.setItem(key, membreId)
  else localStorage.removeItem(key)
}
