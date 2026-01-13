export function FooterBanner() {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100/50 shadow-sm dark:from-orange-950/30 dark:to-amber-950/30 dark:border-orange-800/30">
      <span className="text-sm text-muted-foreground">Built by</span>
      <a
        href="https://opendeved.net/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
      >
        OpenDevEd 
      </a>
      <span className="text-muted-foreground">with</span>
      <a
        href="https://openalex.org"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
      >
        OpenAlex
      </a>
      <div className="w-2 h-2 rounded-full bg-gradient-to-r from-orange-400 to-orange-600"></div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="py-3 border-t border-border/50 shrink-0">
      <div className="container mx-auto px-6">
        <div className="text-center">
          <FooterBanner />
        </div>
      </div>
    </footer>
  );
}
