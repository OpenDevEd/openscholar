import type { ContactTopic } from "../contact";

/** Where people reach Openscholar: the team's inbox, which the contact form on openscholar.ai writes to too. */
export const CONTACT_EMAIL = "habari@openscholar.ai";

/** An email to us about a workspace whose Stripe account is in another currency than the dollars reports are paid in. */
export const CURRENCY_MAIL = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Our Stripe account's currency")}`;

/** The contact page on the marketing site, opened with a topic chosen (marketing/src/pages/contact). */
export const contactPage = (topic: ContactTopic) => `https://openscholar.ai/contact/?topic=${topic}`;
