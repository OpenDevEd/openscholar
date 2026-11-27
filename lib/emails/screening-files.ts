import { escapeHtml } from "../escape-html";
import { emailButton, emailStyles, renderLibraryEmail } from "./library-template";

/**
 * The email that carries a screening's files to a colleague (convex/screening/filesMail.ts): who sent them, from which
 * screening, the files attached, and a link to the screening for whoever can open it. Files stay English, as they do
 * when downloaded.
 */
export function screeningFilesMessage({ origin, path, name, by, replies, files, note }: {
  origin: string;
  /** The screening's own page, with its workspace's prefix where it has one. */
  path: string;
  name: string;
  /** Who sent them. */
  by: string;
  /** Whether a reply reaches them: it does where their account has an address. */
  replies: boolean;
  /** The names of the files attached. */
  files: string[];
  /** What the sender wrote with them. */
  note?: string;
}) {
  const identity = { name: "Openscholar", baseUrl: origin, logoUrl: new URL("/web-app-manifest-192x192.png", origin).href, accent: "#ed7b15" };
  const open = new URL(path, origin).href;
  const subject = `${by} sent you ${files.length === 1 ? "a file" : `${files.length} files`} from "${name}"`;
  const line = `${by} sent you ${files.length === 1 ? "a file" : "files"} from the screening "${name}" on Openscholar. ${files.join(", ")} ${files.length === 1 ? "is" : "are"} attached to this email.`;
  return {
    subject,
    text: `${line}${note ? `\n\n${note}` : ""}\n\nThe screening, for anyone who can open it\n${open}`,
    html: renderLibraryEmail({
      identity,
      title: subject,
      content: `<p style="${emailStyles.paragraph}">${escapeHtml(line)}</p>${note ? `<p style="${emailStyles.paragraph}">${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : ""}${emailButton("Open the screening", open, identity.accent)}`,
      footerHtml: `${escapeHtml(by)} sent you this email from Openscholar.${replies ? " Reply to it to answer them." : ""}`,
    }),
  };
}
