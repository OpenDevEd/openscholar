"use client";

// Where an invitation to an organization links (#651): Clerk's email brings the person here, signed
// in first if they weren't. They join or decline; someone already in it opens it.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Check, Coins, Folder, Lock, Mail, ShieldCheck, UserRound, Users, type AppIcon } from "@/components/icons";
import { PageWrapper } from "@/components/PageWrapper";
import { EASE } from "@/components/settings/model-map";
import { LIST, Tile } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import Link from "@/components/workspace-link";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { cn } from "@/lib/utils";
import { workspaceHref } from "@/lib/workspaces/href";
import { usePlanOf, WorkspaceTile } from "./parts";
import { useAnswerInvitation } from "./switcher";

export function JoinOrganization({ slug }: { slug: string }) {
  const t = useTranslations("workspaces");
  const router = useRouter();
  const { data } = useProtectedQuery(api.organizations.queries.invitationTo, { slug });
  const { answering, join, decline } = useAnswerInvitation();
  const [declined, setDeclined] = useState<string | null>(null);
  const plan = usePlanOf({ kind: "organization", name: "", ...(data && !data.joined && data.plan ? { plan: data.plan } : {}) });
  if (data === undefined) return <Landing />;
  if (declined) {
    return (
      <Landing hero={<Hero icon={Mail} />} title={t("invitationDeclined")} chips={<Chip>{declined}</Chip>}>
        <Button variant="outline" className="w-full" asChild>
          <Link href="/">{t("goToSearch")}</Link>
        </Button>
      </Landing>
    );
  }
  if (data?.joined) {
    return (
      <Landing hero={<WorkspaceTile workspace={{ kind: "organization", name: data.name, imageUrl: data.imageUrl }} size="xl" />} title={t("youreIn", { name: data.name })} chips={<Chip tone="success"><Check className="size-3.5" /> {t("joined")}</Chip>}>
        <Button className="w-full" asChild>
          <Link href={workspaceHref(slug, "/library")}>{t("open", { name: data.name })}</Link>
        </Button>
      </Landing>
    );
  }
  if (!data) return <Gone />;
  const { invitation, members } = data;
  const admin = invitation.role === "admin";
  return (
    <Landing
      hero={<WorkspaceTile workspace={{ kind: "organization", name: invitation.organization.name, imageUrl: invitation.organization.imageUrl }} size="xl" />}
      lead={
        invitation.invitedBy ? (
          <Chip lead={<IdentityAvatar name={invitation.invitedBy.name} imageUrl={invitation.invitedBy.imageUrl} className="size-5" />}>{t("invitedYou", { name: invitation.invitedBy.name })}</Chip>
        ) : null
      }
      title={t("joinName", { name: invitation.organization.name })}
      chips={
        <>
          <Chip>
            <Users className="size-3.5" /> <span className="tabular-nums">{t("members", { count: members })}</span>
          </Chip>
          {plan.name ? <Chip tone="primary">{t("planNamed", { plan: plan.name })}</Chip> : null}
          <Chip>
            {admin ? <ShieldCheck className="size-3.5" /> : <UserRound className="size-3.5" />} {admin ? t("asAdmin") : t("asMember")}
          </Chip>
        </>
      }
    >
      <ul className={LIST}>
        <Point lead={<Tile icon={Folder} tint="#e8890c" className="size-8" />}>{t("pointShared")}</Point>
        <Point lead={<Tile icon={Coins} tint="#facc15" className="size-8" />}>{t("pointCredits")}</Point>
        <Point lead={<Tile icon={Lock} tint="#94a3b8" className="size-8" />}>{t("pointOwn")}</Point>
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={answering !== null} onClick={() => void decline(invitation).then((done) => done && setDeclined(invitation.organization.name))}>
          {t("decline")}
        </Button>
        <Button disabled={answering !== null} onClick={() => void join(invitation).then((joined) => joined && router.push(workspaceHref(slug, "/library")))}>
          {t("join")}
        </Button>
      </div>
    </Landing>
  );
}

const CHIP_TONES = { muted: "bg-muted text-muted-foreground", primary: "bg-primary/10 text-primary", success: "bg-success/10 ink-success" } as const;

/** A pill; a `lead` sits as far from the left edge as from the top and bottom. */
export function Chip({ lead, tone = "muted", children }: { lead?: ReactNode; tone?: keyof typeof CHIP_TONES; children: ReactNode }) {
  return <span className={cn("inline-flex h-7 min-w-0 max-w-full shrink items-center gap-1.5 whitespace-nowrap rounded-full pr-2.5 text-xs", lead ? "pl-1" : "pl-2.5", CHIP_TONES[tone])}>{lead}{children}</span>;
}

/** A page with one thing to decide, in the middle of the screen. */
export function Landing({ hero, lead, title, chips, children }: { hero?: ReactNode; lead?: ReactNode; title?: string; chips?: ReactNode; children?: ReactNode }) {
  return (
    <PageWrapper>
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        {title ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="w-full max-w-md space-y-8">
            <div className="flex flex-col items-center gap-5 text-center">
              {hero}
              <div className="space-y-3">
                {lead ? <div className="flex justify-center">{lead}</div> : null}
                <h1 className="text-balance text-2xl font-semibold tracking-tight">{title}</h1>
                {chips ? <div className="flex flex-wrap justify-center gap-1.5">{chips}</div> : null}
              </div>
            </div>
            {children ? <div className="space-y-4">{children}</div> : null}
          </motion.div>
        ) : null}
      </div>
    </PageWrapper>
  );
}

export function Hero({ icon: Icon }: { icon: AppIcon }) {
  return (
    <span aria-hidden className="flex size-24 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
      <Icon className="size-10" />
    </span>
  );
}

function Gone() {
  const t = useTranslations("workspaces");
  return (
    <Landing hero={<Hero icon={Mail} />} title={t("invitationGoneTitle")} chips={<p className="text-sm text-muted-foreground">{t("invitationGoneDetail")}</p>}>
      <Button variant="outline" className="w-full" asChild>
        <Link href="/">{t("goToSearch")}</Link>
      </Button>
    </Landing>
  );
}

export function Point({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 p-3 text-sm">
      {lead}
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}
