"use client";

// MOCK (mock/onboarding): a new account's profile setup, and the same answers on Settings › Profile.
//
// The setup is the whole page while it's due: the app around it and the page the address names aren't drawn, so none
// of their code runs, and the address stays as it is. Every way in (a redirect back, a sign-in in a dialog, an
// invitation, an app asking to sign in) carries on once the setup is finished or skipped. It never stands in front of
// a page in the middle of such a flow (`inFlow`): it comes on the next page.

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import useSWR from "swr";
import { toast } from "sonner";
import { LogoMark } from "@/components/logo";
import { AffiliationPicker } from "@/components/people/affiliation-picker";
import { OrcidButton, OrcidSearch } from "@/components/people/orcid-search";
import { LIST, Zone } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { readProfileSetup, saveProfileSetup, skipProfileSetup } from "@/app/actions/onboarding-mock";
import { EMAILS, inFlow, type ProfileAnswers, type ProfileSetup } from "@/lib/onboarding-mock/types";
import type { Affiliation } from "@/lib/publish-mock/types";

type Person = { name: string; imageUrl: string | null };

/** Whether the person's answers are in, for a page that waits for them before it shows (Settings › Profile). */
export const useProfileSetupReady = () => useProfileSetup().data !== undefined;

function useProfileSetup() {
  const { isSignedIn, user } = useUser();
  return useSWR(isSignedIn && user ? ["profile-setup", user.id] : null, () => readProfileSetup(), { revalidateOnFocus: false });
}

/**
 * Stands in for everything the app draws while the setup is due. On a page's first load the server decides, and
 * leaves the page out altogether (app/layout.tsx); after that the person's answers decide, as for someone who signs
 * up in a dialog. Finishing or skipping asks the server for the page, and the setup stays until it is in, so the page
 * takes its place in one step. Mounted once, around the app's shell.
 */
export function ProfileSetupGate({ due: dueOnLoad, person, children }: { due: boolean; person: Person | null; children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const setup = useProfileSetup();
  const [done, setDone] = useState(false);
  const [leaving, startLeaving] = useTransition();
  const signedOut = isLoaded && !isSignedIn;
  const due = !done && !signedOut && (setup.data ? setup.data.due : dueOnLoad) && !inFlow(pathname);
  if (!due) return children;
  const who: Person = user ? { name: user.fullName ?? "", imageUrl: user.imageUrl } : (person ?? { name: "", imageUrl: null });
  const leave = (kept: ProfileSetup) =>
    startLeaving(() => {
      setDone(true);
      void setup.mutate({ setup: kept, due: false }, { revalidate: false });
      router.refresh();
    });
  return (
    <>
      <ProfileSetupScreen
        person={who}
        initial={setup.data?.setup}
        leaving={leaving}
        onSave={async (answers) => leave(await saveProfileSetup(answers))}
        onSkip={async () => leave(await skipProfileSetup())}
      />
      <Toaster />
    </>
  );
}

/** The setup, as the whole page. */
function ProfileSetupScreen({ person, initial, leaving, onSave, onSkip }: { person: Person; initial?: ProfileSetup; /** The page it leads to is on its way. */ leaving: boolean; onSave: (answers: ProfileAnswers) => Promise<void>; onSkip: () => Promise<void> }) {
  const [answers, setAnswers] = useState<ProfileAnswers>(() => ({ affiliations: initial?.affiliations ?? [], orcid: initial?.orcid ?? "", emails: initial?.emails ?? { updates: false, news: false, research: false } }));
  const [sending, setSending] = useState<"continue" | "skip" | null>(null);
  const send = async (which: "continue" | "skip") => {
    setSending(which);
    try {
      await (which === "continue" ? onSave(answers) : onSkip());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your profile couldn't be saved.");
      setSending(null);
    }
  };
  const busy = sending !== null || leaving;
  return (
    <main className="flex min-h-dvh justify-center bg-background px-4 py-10 sm:items-center">
      <div className="w-full max-w-md space-y-8">
        <LogoMark className="size-9" />
        <header className="flex items-center gap-3">
          <IdentityAvatar name={person.name} imageUrl={person.imageUrl ?? undefined} className="size-12 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <h1 className="text-xl font-semibold tracking-tight">Set up your profile</h1>
            <p className="text-sm text-muted-foreground">You can change these later in Settings.</p>
          </div>
        </header>
        <div className="space-y-6">
          <Field label="Institution">
            <AffiliationPicker value={answers.affiliations} onChange={(affiliations) => setAnswers((was) => ({ ...was, affiliations }))} />
          </Field>
          <Field label="ORCID iD">
            <OrcidField orcid={answers.orcid} name={person.name} affiliations={answers.affiliations} onChange={(orcid) => setAnswers((was) => ({ ...was, orcid }))} />
          </Field>
          <Field label="Emails from Openscholar">
            <EmailChoices value={answers.emails} onChange={(emails) => setAnswers((was) => ({ ...was, emails }))} />
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => void send("skip")} disabled={busy}>
            {sending === "skip" ? <Spinner /> : null}
            Skip for now
          </Button>
          <Button onClick={() => void send("continue")} disabled={busy}>
            {sending === "continue" ? <Spinner /> : null}
            Continue
          </Button>
        </div>
      </div>
    </main>
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

/** The person's ORCID iD, found on ORCID by their name, those at their institutions first, or pasted. */
function OrcidField({ orcid, name, affiliations, onChange }: { orcid: string; name: string; affiliations: Affiliation[]; onChange: (orcid: string) => void }) {
  const [finding, setFinding] = useState(false);
  return (
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
            onChange(id);
            setFinding(false);
          }}
          onRemove={() => {
            onChange("");
            setFinding(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The emails the person asks for, each with what it brings. */
function EmailChoices({ value, onChange }: { value: ProfileAnswers["emails"]; onChange: (emails: ProfileAnswers["emails"]) => void }) {
  return (
    <div className={LIST}>
      {EMAILS.map((kind) => (
        <label key={kind.id} className="flex cursor-pointer items-start gap-3 bg-inset px-4 py-3">
          <Checkbox checked={value[kind.id]} onCheckedChange={(checked) => onChange({ ...value, [kind.id]: checked === true })} className="mt-0.5" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{kind.label}</span>
            <span className="block text-xs text-muted-foreground">{kind.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** The same answers on Settings › Profile, each saved as it changes. The page shows once they are in (`useProfileSetupReady`). */
export function ProfileSetupSettings() {
  const { user } = useUser();
  const setup = useProfileSetup();
  const saved = setup.data?.setup;
  const change = async (patch: Partial<ProfileAnswers>) => {
    if (!saved) return;
    const next = { ...saved, ...patch };
    // Shown at once; the server's copy replaces it once saved.
    void setup.mutate({ setup: next, due: false }, { revalidate: false });
    try {
      const kept = await saveProfileSetup({ affiliations: next.affiliations, orcid: next.orcid, emails: next.emails });
      await setup.mutate({ setup: kept, due: false }, { revalidate: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That couldn't be saved.");
      await setup.mutate();
    }
  };
  const answers = saved ?? { affiliations: [], orcid: "", emails: { updates: false, news: false, research: false } };
  return (
    <div className="space-y-8">
      <Zone label="Institution">
        <AffiliationPicker value={answers.affiliations} onChange={(affiliations) => void change({ affiliations })} />
      </Zone>
      <Zone label="ORCID iD">
        <OrcidField orcid={answers.orcid} name={user?.fullName ?? ""} affiliations={answers.affiliations} onChange={(orcid) => void change({ orcid })} />
      </Zone>
      <Zone label="Emails from Openscholar">
        <EmailChoices value={answers.emails} onChange={(emails) => void change({ emails })} />
      </Zone>
    </div>
  );
}
