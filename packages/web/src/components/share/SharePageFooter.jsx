// ════════════════════════════════════════════════════════════════════════════
// SharePageFooter — "Powered by captiv." + copyright en bas des pages share
// ════════════════════════════════════════════════════════════════════════════
//
// Affiché tout en bas de chaque page /share/* pour rappeler que le partage
// est propulsé par Captiv. Lien externe vers captiv.cc (target=_blank).
// Style volontairement très discret (small, opacity, centré) pour ne pas
// concurrencer le branding de l'org propriétaire.
//
// Copyright dynamique : prend l'année courante côté client. Pas de date dure.
// ════════════════════════════════════════════════════════════════════════════

export default function SharePageFooter() {
  const year = new Date().getFullYear()
  return (
    <footer
      className="mt-8 pt-6 pb-4 flex flex-col items-center gap-1.5"
      style={{ color: 'var(--txt-3)' }}
    >
      <a
        href="https://captiv.cc"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] transition-opacity"
        style={{
          color: 'var(--txt-3)',
          opacity: 0.55,
          textDecoration: 'none',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.55')}
        title="Captiv. Creative Production Services."
      >
        Powered by <strong>captiv.</strong>
      </a>
      <p
        className="text-[10px]"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      >
        © {year} Captiv. Tous droits réservés.
      </p>
    </footer>
  )
}
