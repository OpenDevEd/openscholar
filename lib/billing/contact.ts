/** Where people reach OpenScholar: what's given by request is asked for here. */
export const CONTACT_EMAIL = "support@openscholar.ai";

const request = (subject: string, body: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export const SOUTHERN_REQUEST = request("Southern plan request", "Name:\nInstitution:\nCountry:\nResearch area:\n");
export const LIBRARIES_REQUEST = request("Evidence Communities request", "Organization:\nWhat the community will cover:\n");
