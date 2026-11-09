import { isAdmin } from "@/lib/publish-mock/admin";
import { readState } from "@/lib/publish-mock/store";

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// MOCK (mock/publish-reports): an email the mock would have sent the team's inbox, shown as it would arrive. The
// real build sends it, and this page doesn't exist.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = (await isAdmin()) ? (await readState()).outbox?.find((e) => e.id === id) : undefined;
  if (!email) return new Response(null, { status: 404 });
  const head = [["To", email.to], ["Reply-To", email.replyTo], ["Subject", email.subject], ["Sent", new Date(email.at).toUTCString()]]
    .map(([label, value]) => `<tr><td style="padding:2px 16px 2px 0;color:#6a6a6a">${label}</td><td>${escape(value ?? "")}</td></tr>`)
    .join("");
  const page = `<!doctype html><meta charset="utf-8"><title>${escape(email.subject)}</title><body style="margin:0;background:#f4f4f2;font:14px/1.5 sans-serif;color:#1c1917"><div style="max-width:640px;margin:32px auto;padding:0 16px"><table style="margin-bottom:16px;font-size:13px">${head}</table><div style="background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:28px">${email.html}</div></div></body>`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}
