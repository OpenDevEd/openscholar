import type { ContactTopic } from "../contact";

/** Where people reach Openscholar: the team's inbox, which the contact form on openscholar.ai writes to too. */
export const CONTACT_EMAIL = "habari@openscholar.ai";

/** The contact page on the marketing site, opened with a topic chosen (marketing/src/pages/contact). */
export const contactPage = (topic: ContactTopic) => `https://openscholar.ai/contact/?topic=${topic}`;
