import type { ContactTopic } from "../contact";

/** Where people reach Openscholar: the team's inbox, which the contact form on openscholar.ai writes to too. */
export const CONTACT_EMAIL = "habari@openscholar.ai";

/** The contact form on the marketing site with a topic chosen, opened at the form (marketing/src/pages/contact). */
export const contactPage = (topic: ContactTopic) => `https://openscholar.ai/contact/?topic=${topic}#form`;
