## Design Context

### Users
Academic researchers, systematic review teams, and literature screening professionals. They come to OpenScholar to find, screen, and organize research papers across 250M+ works. Their context is often high-stakes (systematic reviews, grant proposals, thesis research) where missing a relevant paper has real consequences. Many are not deeply technical — the tool must feel intuitive without sacrificing power.

### Brand Personality
**Clean, Friendly, Approachable.** OpenScholar should feel like a helpful colleague, not an intimidating enterprise tool. The interface lowers barriers for researchers who may not be tech-savvy while still delivering powerful AI-driven capabilities. The tone is warm but precise — never cold, never flashy.

### Emotional Goals
The interface should simultaneously deliver:
- **Confidence & Control** — Researchers trust the results and feel in command of complex workflows
- **Delight & Discovery** — Finding papers feels rewarding; moments of surprise and satisfaction are designed in
- **Calm & Focus** — The UI disappears during deep work; researchers stay in flow, undistracted by noise
- **Speed & Efficiency** — Everything feels fast and frictionless; researchers accomplish more in less time

### Aesthetic Direction
- **Visual tone**: Clean, modern, information-dense but never cluttered. Warm orange primary conveys approachability; violet AI accents signal intelligence without intimidation.
- **Theme**: Light and dark modes, both carefully tuned. OKLCH color space for perceptual uniformity.
- **Typography**: Outfit (variable) as the primary sans-serif — geometric, friendly, highly legible at all sizes.
- **Motion**: Spring-based animations (Motion library) — responsive and natural, never decorative or slow. Interactions should feel physically grounded.
- **Anti-references**: Traditional academic databases (PubMed, Web of Science) — functional but dated, dense, uninviting. OpenScholar should feel like the modern alternative.

### Design Principles

1. **Clarity over cleverness** — Every element must earn its place. Prefer whitespace and hierarchy over decoration. If a researcher has to think about the UI instead of their research, we've failed.

2. **Trust through transparency** — Show confidence scores, source counts, disagreements, and provenance. Researchers need to verify, not just consume. Never hide the data behind the AI.

3. **Progressive disclosure** — Surface the essential, reveal the detailed on demand. Summary cards lead to question panels lead to individual paper results. Each layer adds depth without adding overwhelm.

4. **Warmth at scale** — The interface handles 250M+ papers but should feel personal. Friendly copy, approachable colors, subtle animations — these humanize a massive dataset.

5. **Accessibility as a first-class feature** — Target WCAG AAA (7:1 contrast, enhanced focus indicators, full reduced-motion support, extensive alt text, screen reader excellence). Academic tools serve diverse global users; no one gets left behind.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
