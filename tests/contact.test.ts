import { describe, expect, it } from "vitest";
import { contactEmail, contactMessage } from "@/lib/contact";

// The contact form's messages come from anyone on the marketing site: the server takes only what each topic needs.
const sender = { name: "Amina Bello", email: "amina@example.org" };
const problems = (input: unknown) => {
  const parsed = contactMessage.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
};

describe("contact messages", () => {
  it("takes a topic's message with what it needs", () => {
    expect(problems({ topic: "bug", ...sender, message: "The export button does nothing." })).toEqual([]);
    expect(problems({ topic: "southern", ...sender, country: "Kenya", project: "Early-grade reading in public schools." })).toEqual([]);
  });

  it("refuses a topic's message without what it needs", () => {
    expect(problems({ topic: "community", ...sender, project: "Too short" })).toEqual(["project"]);
    expect(problems({ topic: "account", ...sender, project: "A project is not what this topic asks for." })).toEqual(["message"]);
    expect(problems({ topic: "southern", ...sender, project: "Early-grade reading in public schools." })).toEqual(["country"]);
  });

  it("refuses an unknown topic, a bad address, an over-long field and fields the form doesn't have", () => {
    expect(problems({ topic: "sales", ...sender, message: "Hello" })).toEqual(["topic"]);
    expect(problems({ topic: "other", ...sender, email: "amina@", message: "Hello" })).toEqual(["email"]);
    expect(problems({ topic: "other", ...sender, message: "x".repeat(3_001) })).toEqual(["message"]);
    expect(problems({ topic: "other", ...sender, message: "Hello", phone: "123" })).toEqual([""]);
  });

  it("keeps what someone wrote out of the email's markup", () => {
    const email = contactEmail(contactMessage.parse({ topic: "other", ...sender, message: "<script>alert(1)</script>" }));
    expect(email.html).not.toContain("<script>");
    expect(email.text).toContain("<script>alert(1)</script>");
  });
});
