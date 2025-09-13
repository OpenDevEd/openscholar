export function FooterBanner() {
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100/50 shadow-sm">
      <span className="text-sm text-muted-foreground">Built with</span>
{/* https://opendeved.net/ */}
      <a
        href="https://opendeved.net/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-orange-600 hover:text-orange-700 transition-colors"
      >
        OpenDevEd 
      </a>
      with
      <a
        href="https://openalex.org"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
      >
        OpenAlex
      </a>
      <div className="w-2 h-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="py-8">
      <div className="container mx-auto px-6">
        <div className="text-center">
          <FooterBanner />
        </div>
      </div>
    </footer>
  );
}
