"use client";

// MOCK (mock/onboarding): a new account's profile setup. It opens over whatever page the person lands on, so no
// address changes and every way in (a redirect back, a sign-in in a dialog, an invitation, an app asking to sign in)
// carries on as before. It waits on pages that are part of such a flow, and while the cookie banner is unanswered.

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Pencil } from "@/components/icons";
import { OrcidIcon } from "@/components/icons/author-service-icons";
import { AffiliationPicker } from "@/components/people/affiliation-picker";
import { OrcidButton, OrcidSearch } from "@/components/people/orcid-search";
import { RorLink } from "@/components/papers/paper-entities";
import { LIST, Zone } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CountryFlag } from "@/components/ui/country-flag";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { readProfileSetup, saveProfileSetup, skipProfileSetup } from "@/app/actions/onboarding-mock";
import { CONSENT_UPDATED_EVENT, readConsent } from "@/lib/consent-cookie";
import { EMAILS, type ProfileSetup } from "@/lib/onboarding-mock/types";

/** Pages in the middle of a flow: signing in, an app asking to sign in, an invitation, a community's hand-off. */
const FLOW_PATHS = ["/sign-in", "/sign-up", "/connect", "/join", "/from-library"];
const inFlow = (pathname: string) => FLOW_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/** The cookie banner's answer, which a browser event announces: the setup never opens on top of the banner. */
const subscribeConsent = (changed: () => void) => {
  window.addEventListener(CONSENT_UPDATED_EVENT, changed);
  return () => window.removeEventListener(CONSENT_UPDATED_EVENT, changed);
};
const useConsentAnswered = () => useSyncExternalStore(subscribeConsent, () => readConsent() !== null, () => false);

/** `?setup=profile` opens the setup from anywhere, as Settings does. */
const useAsked = () => useQueryState("setup", parseAsStringLiteral(["profile"] as const));

/**
 * Whether this page put `?setup=profile` in the address as a history step of its own. Closing then takes that step
 * back, so Back afterwards never reopens it; an address that came with it is put right in place instead.
 * ponytail: one flag for the page, since one setup is open at a time.
 */
let openedHere = false;

function useProfileSetup() {
  const { isSignedIn, user } = useUser();
  return useSWR(isSignedIn && user ? ["profile-setup", user.id] : null, () => readProfileSetup(), { revalidateOnFocus: false });
}

/** Opens the setup for a new account once, and whenever the address asks for it. Mounted once, in the app's shell. */
export function ProfileSetupHost() {
  const { user } = useUser();
  const pathname = usePathname();
  const [asked, setAsked] = useAsked();
  const consented = useConsentAnswered();
  const setup = useProfileSetup();
  const data = setup.data;
  const open = !!user && !!data && (asked === "profile" || (data.due && consented && !inFlow(pathname)));

  const finish = async (answers: Pick<ProfileSetup, "affiliations" | "orcid" | "emails">) => {
    const saved = await saveProfileSetup(answers);
    await setup.mutate({ setup: saved, due: false }, { revalidate: false });
    close();
    toast.success("Profile saved");
  };
  // Skipping, or closing it any other way, puts it away for good; answers saved before stay.
  const dismiss = () => {
    if (data?.due) {
      void setup.mutate({ ...data, due: false }, { revalidate: false });
      void skipProfileSetup();
    }
    close();
  };
  function close() {
    if (asked !== "profile") return;
    if (openedHere) {
      openedHere = false;
      window.history.back();
    } else void setAsked(null, { history: "replace" });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent showCloseButton={false} className="gap-6 sm:max-w-lg">
        {data && user ? <ProfileSetupForm initial={data.setup} name={user.fullName ?? ""} imageUrl={user.imageUrl} onSave={finish} onSkip={dismiss} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <span className="block ps-1 text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** The questions. They live inside the dialog, so each opening starts from what is saved. */
function ProfileSetupForm({ initial, name, imageUrl, onSave, onSkip }: { initial: ProfileSetup; name: string; imageUrl: string; onSave: (answers: Pick<ProfileSetup, "affiliations" | "orcid" | "emails">) => Promise<void>; onSkip: () => void }) {
  const [affiliations, setAffiliations] = useState(initial.affiliations);
  const [orcid, setOrcid] = useState(initial.orcid);
  const [emails, setEmails] = useState(initial.emails);
  const [finding, setFinding] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await onSave({ affiliations, orcid, emails });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your profile couldn't be saved.");
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 text-start">
        <IdentityAvatar name={name} imageUrl={imageUrl} className="size-11 shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <DialogTitle>Set up your profile</DialogTitle>
          <DialogDescription>You can change these later in Settings.</DialogDescription>
        </div>
      </DialogHeader>
      <div className="space-y-5">
        <Field label="Institution">
          <AffiliationPicker value={affiliations} onChange={setAffiliations} />
        </Field>
        <Field label="ORCID iD">
          <Popover modal open={finding} onOpenChange={setFinding}>
            <PopoverAnchor asChild>
              <div>
                <OrcidButton orcid={orcid} open={finding} onClick={() => setFinding(true)} className="w-full" />
              </div>
            </PopoverAnchor>
            <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
              <OrcidSearch
                name={name}
                institutions={affiliations.map((a) => a.name)}
                current={orcid}
                onPick={(id) => {
                  setOrcid(id);
                  setFinding(false);
                }}
                onRemove={() => {
                  setOrcid("");
                  setFinding(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </Field>
        <Field label="Emails from Openscholar">
          <div className={LIST}>
            {EMAILS.map((kind) => (
              <label key={kind.id} className="flex cursor-pointer items-start gap-3 bg-inset px-4 py-3">
                <Checkbox checked={emails[kind.id]} onCheckedChange={(checked) => setEmails((was) => ({ ...was, [kind.id]: checked === true }))} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{kind.label}</span>
                  <span className="block text-xs text-muted-foreground">{kind.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      </div>
      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" onClick={onSkip} disabled={saving}>
          Skip for now
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

/** What the setup holds, on Settings › Profile, with the button that opens it again. */
export function ProfileSetupSummary() {
  const setup = useProfileSetup();
  const [, setAsked] = useAsked();
  const answers = setup.data?.setup;
  const chosen = EMAILS.filter((kind) => answers?.emails[kind.id]);
  return (
    <Zone
      label="Institution, ORCID iD and emails"
      aside={
        <Button variant="ghost" size="sm" aria-label="Edit your institution, ORCID iD and emails" className="h-7 px-2 text-xs text-primary" onClick={() => {
            openedHere = true;
            void setAsked("profile", { history: "push" });
          }}>
          <Pencil className="size-3.5" />
          Edit
        </Button>
      }
    >
      {/* Its rows are drawn from the first frame, empty until the answers are in, so nothing below moves. */}
      <div className={LIST}>
        <Row label="Institution">
          {answers?.affiliations.length ? (
            <span className="flex flex-wrap gap-1.5">
              {answers.affiliations.map((a) => (
                <span key={a.id ?? a.ror ?? a.name} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
                  {a.country ? <CountryFlag countryCode={a.country} /> : null}
                  <span className="truncate">{a.name}</span>
                  {a.ror ? <RorLink ror={a.ror} label={`${a.name} on ROR`} /> : null}
                </span>
              ))}
            </span>
          ) : (
            <Empty ready={!!answers} />
          )}
        </Row>
        <Row label="ORCID iD">
          {answers?.orcid ? (
            <a href={`https://orcid.org/${answers.orcid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-xs hover:underline">
              <OrcidIcon className="size-3.5" />
              {answers.orcid}
            </a>
          ) : (
            <Empty ready={!!answers} />
          )}
        </Row>
        <Row label="Emails">
          {chosen.length ? (
            <span className="flex flex-wrap gap-1.5">
              {chosen.map((kind) => (
                <span key={kind.id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
                  <Check className="size-3 text-primary" />
                  {kind.label}
                </span>
              ))}
            </span>
          ) : (
            <Empty ready={!!answers} />
          )}
        </Row>
      </div>
    </Zone>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 bg-inset px-4 py-2.5">
      <span className="w-28 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-sm">{children}</span>
    </div>
  );
}

const Empty = ({ ready }: { ready: boolean }) => <span className={ready ? "text-xs text-subtle-foreground" : "invisible text-xs"}>None yet</span>;
