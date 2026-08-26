"use client";

import { Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  type AccessGrant,
  type AccessRole,
  newId,
  type Visibility,
} from "@/lib/evidence-libraries/mock/config";
import { initialsOf } from "@/lib/evidence-libraries/mock/data";
import {
  selectOrganization,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { StatusChip } from "../library-status-badge";
import { OrgAvatar } from "../org-avatar";
import { Field, InlineNotice } from "../section-card";
import { AddButton, ChoiceCards, EmptyList, FieldError, FieldGroup } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const ROLES: AccessRole[] = ["editor", "viewer"];
const VISIBILITIES: Visibility[] = ["public", "members"];

/** Organisations the invite search can find. */
const FAKE_ORGS = [
  { orgId: "org_2", name: "Open Development & Education", members: 14 },
  { orgId: "org_unesco", name: "UNESCO", members: 120 },
  { orgId: "org_edtechhub", name: "EdTech Hub", members: 32 },
  { orgId: "org_cambridge", name: "University of Cambridge", members: 480 },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TeamSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.team");
  const tc = useTranslations("common");
  const organization = useEvidenceLibraryMockStore(selectOrganization);
  const invite = useEvidenceLibraryMockStore((s) => s.invite);
  const team = library.draft.team;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<AccessGrant | null>(null);

  function setRole(grantId: string, role: AccessRole) {
    patch((d) => {
      const grant = d.team.grants.find((g) => g.id === grantId);
      if (grant) grant.role = role;
      return d;
    });
  }

  function remove(grantId: string) {
    patch((d) => {
      d.team.grants = d.team.grants.filter((g) => g.id !== grantId);
      return d;
    });
  }

  function addGrant(grant: AccessGrant) {
    patch((d) => {
      d.team.grants.push(grant);
      return d;
    });
    if (grant.status === "invited") invite(library.id, grant.id);
    setInviteOpen(false);
  }

  return (
    <SectionShell sectionKey="team" icon={Users} description={t("description")} library={library}>
      <FieldGroup title={t("visibilityHeading")}>
        <ChoiceCards
          columns={2}
          value={team.visibility}
          ariaLabel={t("visibilityHeading")}
          onChange={(v) =>
            patch((d) => {
              d.team.visibility = v;
              return d;
            })
          }
          options={VISIBILITIES.map((value) => ({
            value,
            label: t(`visibility.${value}`),
            hint: t(`visibilityHint.${value}`),
          }))}
        />
      </FieldGroup>

      <FieldGroup title={t("ownersHeading")}>
        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
          <OrgAvatar initials={organization.initials} color={organization.color} />
          <p className="text-sm">{t("ownersLine", { org: organization.name })}</p>
        </div>
      </FieldGroup>

      <FieldGroup
        title={t("accessHeading")}
        action={<AddButton onClick={() => setInviteOpen(true)}>{t("invite")}</AddButton>}
      >
        {team.grants.length === 0 ? (
          <EmptyList>{t("noGrants")}</EmptyList>
        ) : (
          <div className="rounded-lg border border-border/50 bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colWho")}</TableHead>
                  <TableHead className="w-36">{t("colRole")}</TableHead>
                  <TableHead className="w-28">{t("colStatus")}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{tc("remove")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.grants.map((grant) => (
                  <TableRow key={grant.id} data-grant-status={grant.status}>
                    <TableCell>
                      <GrantSubject grant={grant} />
                    </TableCell>
                    <TableCell>
                      <Select value={grant.role} onValueChange={(v) => setRole(grant.id, v as AccessRole)}>
                        <SelectTrigger size="sm" className="w-full bg-background" aria-label={t("colRole")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {t(`role.${role}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <StatusChip tone={grant.status === "active" ? "success" : "warning"}>
                        {t(`status.${grant.status}`)}
                      </StatusChip>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={t("removeAccess", { name: subjectName(grant) })}
                        onClick={() => setRemoving(grant)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <InlineNotice tone="info">{t("roleRule")}</InlineNotice>
      </FieldGroup>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
        <p className="text-sm">
          {t("planLabel")}{" "}
          <span className="font-medium">{t("planFree")}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => toast(t("manageToast"))}
        >
          {t("manage")}
        </Button>
      </div>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        grants={team.grants}
        onAdd={addGrant}
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("removeTitle", { name: removing ? subjectName(removing) : "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (removing) remove(removing.id);
                setRemoving(null);
              }}
            >
              {tc("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  );
}

function subjectName(grant: AccessGrant) {
  const s = grant.subject;
  return s.kind === "person" ? s.name || s.email : s.name;
}

function GrantSubject({ grant }: { grant: AccessGrant }) {
  const t = useTranslations("evidenceLibraryMock.config.team");
  const s = grant.subject;
  const name = subjectName(grant);
  const secondary =
    s.kind === "person" ? s.email : t("orgMembers", { members: s.members });
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-8">
        <AvatarFallback className="text-xs">{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{name}</span>
          {s.kind === "organization" ? <StatusChip tone="neutral">{t("orgChip")}</StatusChip> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  grants,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grants: AccessGrant[];
  onAdd: (grant: AccessGrant) => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.team");
  const tc = useTranslations("common");
  const [tab, setTab] = useState<"person" | "organization">("person");
  const [email, setEmail] = useState("");
  const [personRole, setPersonRole] = useState<AccessRole>("viewer");
  const [query, setQuery] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgRole, setOrgRole] = useState<AccessRole>("viewer");
  const [error, setError] = useState<string | null>(null);

  const matches = FAKE_ORGS.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedOrg = FAKE_ORGS.find((o) => o.orgId === orgId) ?? null;

  function reset() {
    setEmail("");
    setQuery("");
    setOrgId(null);
    setError(null);
    setPersonRole("viewer");
    setOrgRole("viewer");
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function submit() {
    if (tab === "person") {
      const value = email.trim().toLowerCase();
      if (!EMAIL.test(value)) {
        setError(t("emailInvalid"));
        return;
      }
      const exists = grants.some((g) => g.subject.kind === "person" && g.subject.email.toLowerCase() === value);
      if (exists) {
        setError(t("emailDuplicate"));
        return;
      }
      onAdd({
        id: newId("g"),
        subject: { kind: "person", email: value, name: "" },
        role: personRole,
        status: "invited",
      });
      reset();
      return;
    }
    if (!selectedOrg) {
      setError(t("orgMissing"));
      return;
    }
    const exists = grants.some((g) => g.subject.kind === "organization" && g.subject.orgId === selectedOrg.orgId);
    if (exists) {
      setError(t("orgDuplicate"));
      return;
    }
    onAdd({
      id: newId("g"),
      subject: { kind: "organization", ...selectedOrg },
      role: orgRole,
      status: "active",
    });
    reset();
  }

  const canSubmit = tab === "person" ? email.trim().length > 0 : selectedOrg !== null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("inviteTitle")}</DialogTitle>
          <DialogDescription>{t("inviteBody")}</DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "person" | "organization");
            setError(null);
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="person" className="flex-1">{t("tabPerson")}</TabsTrigger>
            <TabsTrigger value="organization" className="flex-1">{t("tabOrganization")}</TabsTrigger>
          </TabsList>
          <TabsContent value="person" className="space-y-4 pt-3">
            <Field label={t("emailLabel")}>
              {(id, invalid) => (
                <Input
                  id={id}
                  type="email"
                  className="bg-background"
                  placeholder="name@example.org"
                  value={email}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              )}
            </Field>
            <RoleField value={personRole} onChange={setPersonRole} />
          </TabsContent>
          <TabsContent value="organization" className="space-y-4 pt-3">
            <Field label={t("orgSearchLabel")}>
              {(id) => (
                <Input
                  id={id}
                  className="bg-background"
                  placeholder={t("orgSearchPlaceholder")}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setError(null);
                  }}
                />
              )}
            </Field>
            {matches.length === 0 ? (
              <EmptyList>{t("orgNoMatch")}</EmptyList>
            ) : (
              <ul className="space-y-1" role="listbox" aria-label={t("orgSearchLabel")}>
                {matches.map((org) => {
                  const selected = org.orgId === orgId;
                  return (
                    <li key={org.orgId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border border-border/50 bg-background p-2.5 text-left hover:bg-muted/30",
                          selected && "border-primary/50 bg-primary/5",
                        )}
                        onClick={() => {
                          setOrgId(org.orgId);
                          setError(null);
                        }}
                      >
                        <Avatar className="size-7">
                          <AvatarFallback className="text-[10px]">{initialsOf(org.name)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{org.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t("orgMembers", { members: org.members })}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <RoleField value={orgRole} onChange={setOrgRole} />
          </TabsContent>
        </Tabs>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {tc("cancel")}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={submit}>
            {t("inviteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleField({ value, onChange }: { value: AccessRole; onChange: (role: AccessRole) => void }) {
  const t = useTranslations("evidenceLibraryMock.config.team");
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-5 items-center"><Label className="font-normal">{t("colRole")}</Label></div>
      <Select value={value} onValueChange={(v) => onChange(v as AccessRole)}>
        <SelectTrigger className="w-full bg-background" aria-label={t("colRole")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {t(`role.${role}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
