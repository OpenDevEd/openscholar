import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL } from "../billing/contact";
import { MAIL_EVENTS, reportEmail, type MailFacts } from "./emails";

const report: MailFacts = { key: "R100007", doi: "10.53832/openscholar-r.r100007", title: "Shade trees & maize", activated: false, live: false, signer: "Ada Author", authorEmail: "ada@example.org", results: [], deposit: "none", archive: "none" };
const origin = "https://openscholar.ai/";
const links = (text: string) => text.match(/https?:\/\/\S+/g) ?? [];

describe("a report's emails", () => {
  it("go to the team with replies to the author, or to the author with replies to the team", () => {
    const team = reportEmail("review-requested", report, origin)!;
    expect(team).toMatchObject({ audience: "team", to: CONTACT_EMAIL, replyTo: "ada@example.org", subject: "Review requested: Shade trees & maize (R100007)" });
    const author = reportEmail("approved", report, origin)!;
    expect(author).toMatchObject({ audience: "author", to: "ada@example.org", replyTo: CONTACT_EMAIL, subject: "A reviewer approved your report: Shade trees & maize" });
    // The author's address is the team's to read, never an author's own email's to repeat.
    expect(team.text).toContain("Ada Author <ada@example.org>");
    expect(author.text).not.toContain("ada@example.org");
  });

  it("are not written to an author with no address, and the team's then reply to the team", () => {
    const nobody = { ...report, authorEmail: null };
    expect(reportEmail("declined", nobody, origin)).toBeNull();
    expect(reportEmail("live", nobody, origin)).toMatchObject({ replyTo: CONTACT_EMAIL });
  });

  it("link a reviewer to the report's dialog, and an author to the report on Publish or to its page once live", () => {
    for (const event of MAIL_EVENTS) {
      const email = reportEmail(event, { ...report, activated: true, live: true }, origin)!;
      const opened = links(email.text).filter((link) => link.startsWith("https://openscholar.ai"));
      // Every email opens something of ours, by an absolute address with no doubled slash.
      expect(opened.length, event).toBeGreaterThan(0);
      for (const link of opened) expect(link, event).toMatch(/^https:\/\/openscholar\.ai\/(settings\/admin\/publishing\?report=R100007|publish\?report=R100007|papers\/R100007)$/);
      if (email.audience === "team") expect(opened, event).toContain("https://openscholar.ai/settings/admin/publishing?report=R100007");
      else expect(opened.join(" "), event).not.toContain("/settings/admin");
    }
  });

  it("give the DOI as a link only once the report has gone live", () => {
    expect(reportEmail("approved", report, origin)!.text).toContain("DOI 10.53832/openscholar-r.r100007, reserved");
    expect(reportEmail("live-author", { ...report, activated: true, live: true }, origin)!.text).toContain("https://doi.org/10.53832/openscholar-r.r100007");
  });

  it("escape what an author typed, in the HTML", () => {
    const email = reportEmail("declined", { ...report, title: "<script>x</script>", note: "See <b>this</b>" }, origin)!;
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>this</b>");
  });
});
