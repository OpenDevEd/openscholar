"use client";

// A new account's profile setup (convex/users/profileSetup.ts), and the same answers on Settings › Profile.
//
// The setup is the whole page while it's due: the app around it and the page the address names aren't drawn, so none
// of their code runs, and the address stays as it is. On a page's first load the server decides, and leaves the page
// out altogether (app/layout.tsx). Every way in (a redirect back, a sign-in in a dialog, an invitation, an app asking
// to sign in) carries on once the setup is finished or skipped, and it never stands in front of a page in the middle
// of such a flow (`inFlow`): it comes on the next page.

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { LogOut } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { AffiliationPicker } from "@/components/people/affiliation-picker";
import { OrcidButton, OrcidSearch } from "@/components/people/orcid-search";
import { LIST, Zone } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { showStyledToast, Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { EMAILS, NO_EMAILS, inFlow, type EmailKind } from "@/lib/profile/setup";
import type { Affiliation } from "@/lib/reports/report";
import { getErrorMessage } from "@/lib/toast/use-app-toast";

type Person = { name: string; imageUrl: string | null };
type Answers = { affiliations: Affiliation[]; orcid: string; emails: Record<EmailKind, boolean> };

const useSetup = () => useProtectedQuery(api.users.profileSetup.get, {});

/**
 * Stands in for everything the app draws while the setup is due. Before the person's answers are in, the server's
 * word for the first load holds; after, the answers decide, as for someone who signs up in a dialog. Finishing or
 * skipping asks the server for the page, and the setup stays until it is in, so the page takes its place in one step.
 * Mounted once, around the app's shell.
 */
export function ProfileSetupGate({ due: dueOnLoad, person, children }: { due: boolean; person: Person | null; children: ReactNode }) {
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const setup = useSetup();
  const save = useMutation(api.users.profileSetup.save);
  const skip = useMutation(api.users.profileSetup.skip);
  // Who finished or skipped it here: another account signing in on this page is asked afresh.
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const [leaving, startLeaving] = useTransition();
  const done = !!user && doneFor === user.id;
  // A page the server left out stays the setup until the refreshed page replaces it, whatever the answers say
  // meanwhile; otherwise the person's answers decide.
  const due = !done && !setup.isAnonymous && (dueOnLoad || setup.data?.due === true) && !inFlow(pathname);
  if (!due) return children;
  const who: Person = user ? { name: user.fullName ?? "", imageUrl: user.imageUrl } : (person ?? { name: "", imageUrl: null });
  const leave = () =>
    startLeaving(() => {
      setDoneFor(user?.id ?? null);
      router.refresh();
    });
  return (
    <>
      <ProfileSetupScreen
        person={who}
        initial={setup.data?.profile}
        leaving={leaving}
        onSave={async (answers) => {
          await save(answers);
          leave();
        }}
        onSkip={async () => {
          await skip({});
          leave();
        }}
      />
      <Toaster />
    </>
  );
}

/** The setup, as the whole page. */
function ProfileSetupScreen({ person, initial, leaving, onSave, onSkip }: { person: Person; initial?: Answers; /** The page it leads to is on its way. */ leaving: boolean; onSave: (answers: Answers) => Promise<void>; onSkip: () => Promise<void> }) {
  const [answers, setAnswers] = useState<Answers>(() => initial ?? { affiliations: [], orcid: "", emails: NO_EMAILS });
  const [sending, setSending] = useState<"continue" | "skip" | null>(null);
  const send = async (which: "continue" | "skip") => {
    setSending(which);
    try {
      await (which === "continue" ? onSave(answers) : onSkip());
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, "Your profile couldn't be saved."));
      setSending(null);
    }
  };
  const busy = sending !== null || leaving;
  return (
    <main className="flex min-h-dvh justify-center bg-background px-4 py-10 sm:items-center">
      <div className="w-full max-w-md space-y-8">
        <div className="flex items-center justify-between gap-3">
          <LogoMark className="size-9" />
          <SignOutButton />
        </div>
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

/**
 * Signing out from the setup, the only way out of the page other than finishing or skipping it. It leaves as the
 * rail's Sign out does, and the page is loaded again from the server, which draws it for someone signed out.
 */
function SignOutButton() {
  const t = useTranslations("common");
  const tw = useTranslations("workspaces");
  const { signOut } = useClerk();
  const [leaving, setLeaving] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={leaving}
      className="text-muted-foreground"
      onClick={() => {
        setLeaving(true);
        signOut()
          .then(() => window.location.reload())
          .catch(() => {
            setLeaving(false);
            showStyledToast("error", tw("signOutFailed"));
          });
      }}
    >
      {leaving ? <Spinner /> : <LogOut />}
      {t("signOut")}
    </Button>
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
      <PopoverTrigger asChild>
        <OrcidButton orcid={orcid} open={finding} className="w-full" />
      </PopoverTrigger>
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
function EmailChoices({ value, onChange }: { value: Answers["emails"]; onChange: (emails: Answers["emails"]) => void }) {
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

/** Whether the person's answers are in, for a page that waits for them before it shows (Settings › Profile). */
export const useProfileSetupReady = () => useSetup().data !== undefined;

/** The same answers on Settings › Profile, each saved as it changes. The page shows once they are in (`useProfileSetupReady`). */
export function ProfileSetupSettings() {
  const { user } = useUser();
  const setup = useSetup();
  // Shown at once, as saved: the server's copy replaces it when the save is in.
  const save = useMutation(api.users.profileSetup.save).withOptimisticUpdate((store, answers) => {
    const now = store.getQuery(api.users.profileSetup.get, {});
    if (now) store.setQuery(api.users.profileSetup.get, {}, { ...now, profile: answers, due: false });
  });
  const answers = setup.data?.profile ?? { affiliations: [], orcid: "", emails: NO_EMAILS };
  const change = (patch: Partial<Answers>) =>
    save({ ...answers, ...patch }).catch((error: unknown) => showStyledToast("error", getErrorMessage(error, "That couldn't be saved.")));
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
