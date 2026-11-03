/** Where people reach OpenScholar: what's given by request is asked for here. */
export const CONTACT_EMAIL = "contact@opendeved.net";

const request = (subject: string, body: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export const SOUTHERN_REQUEST = request("Southern plan request", "Name:\nInstitution:\nCountry:\nResearch area:\n");
export const LIBRARIES_REQUEST = request("Evidence Libraries request", "Organization:\nWhat the library will cover:\n");
