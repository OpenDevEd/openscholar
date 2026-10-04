/**
 * Bare /results route. The work happens in the layout's SearchInitializer,
 * which (Branch A) mints a new searchId and redirects to /results/[id] — so
 * /results always ends up rendering results, with an empty query being a valid
 * empty search. This page is just the spinner shown while that resolves.
 */
export default function ResultsPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}
