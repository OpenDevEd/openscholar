# OpenScholar

OpenScholar is an academic search engine built on top of OpenAlex. It combines a 250M+ paper database with AI tools to help researchers find, screen, and organize literature.

It's designed for systematic reviews and complex queries, not just keyword matching.

## Features

### Search & Discovery

- **Smart Querying:** Write natural language questions or use strict Boolean syntax (AND/OR/NOT).
- **AI Enhancement:** Automatically converts research questions into optimized Boolean queries.
- **Multi-language:** Translate queries and results on the fly without losing precision.
- **Deep Filters:** Filter by year, region, language, document type, and citation count.
- **Citation Graph:** Traverse research by checking who cited a paper and what it cites.

### Systematic Review

- **Automated Screening:** Define screening questions (e.g., "Does this study use a randomized controlled trial?") and let AI screen papers for you.
- **Tracking:** Keep track of included/excluded papers per search.

### Organization

- **Bookmarks:** Create shorthand keywords (e.g., `ai-med`) that expand into complex query strings.
- **History:** Track how your search queries evolve over time.
- **Export:** Download results as JSON/CSV or sync directly to Zotero.

### AI Configuration

- **Provider Choice:** Support for OpenAI, Anthropic, Google, and OpenRouter (300+ models).
- **Flexible Usage:** Bring your own API keys (BYOK) or use the built-in credit system.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Convex (Real-time)
- **Auth:** WorkOS
- **Billing:** Stripe
- **Styling:** Tailwind CSS 4, Radix UI, Motion
- **State:** Zustand, SWR

## Getting Started

1. **Clone the repo**

   ```bash
   git clone https://github.com/yourusername/openalex-count.git
   cd openalex-count
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Environment Setup**
   Copy `.env.example` to `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   You'll need credentials for:
   - **Convex:** `NEXT_PUBLIC_CONVEX_URL`
   - **Convex HTTP (optional/custom domain):** `NEXT_PUBLIC_CONVEX_SITE_URL`
   - **WorkOS:** Client ID, API Key, Redirect URI
   - **Stripe:** Publishable Key (optional, for billing)

4. **Run the development server**

   ```bash
   npm run dev
   ```

   This starts the Next.js app and the Convex dev server.

## Project Structure

- `/app` - Next.js App Router pages and layouts
- `/components` - React components (shadcn/ui, custom)
- `/convex` - Backend functions, schema, and cron jobs
- `/lib` - Utilities, stores (Zustand), and types
