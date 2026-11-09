"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  Users,
  Plus,
  Search,
  Mail,
  Trash2,
  RotateCcw,
  X,
  MoreHorizontal,
  Clock3,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Building2,
} from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { EmailAvatar, PersonName, ROLE_ICONS, RoleLabel } from "@/components/ui/identity";
import { WorkspaceTile, type WorkspaceLook } from "@/components/workspaces/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
  CommandGroup,
} from "@/components/ui/command";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { EmptyList } from "../fields";
import { FieldError, SectionCard } from "../section-card";
import { Disclosure } from "../disclosure-button";

type Role = "Owner" | "Editor" | "Creator";
export type AccessMember = {
  id: string;
  name: string;
  email: string;
  imageUrl?: string;
  role: Role;
  invited: boolean;
  delivery?: "queued" | "sent" | "failed";
  protected?: boolean;
  /** The person looking at the list, who gets a You chip. */
  you?: boolean;
  /** A whole organization the community is shared with (#1091), drawn as the workspace switcher draws it; its ID is the member's. */
  organization?: WorkspaceLook;
  /** An invitation for an organization, whose admin picks which of theirs gets it on accepting. */
  toOrganization?: boolean;
};

/** The organization picked in the Add member dialog: one of the owner's, or another, through its admin's email. */
const ANOTHER = "another";

/** Organization members one page of the picker shows; typing narrows them. */
const PEOPLE_PAGE_SIZE = 20;
type Person = Pick<AccessMember, "id" | "name" | "email" | "imageUrl">;

/**
 * The picker's list: the library organization's members, searched on the server a page at a
 * time, since an organization can have any number. Mounted only while the picker is open.
 * Results kept from an earlier search stay dimmed and can't be picked until the new ones come.
 */
function OrganizationPeople({ libraryId, members, selected, onSelect }: { libraryId?: Id<"evidenceLibraries">; members: AccessMember[]; selected: Person | null; onSelect: (person: Person) => void }) {
  const t = useTranslations("libraryTeamAccess");
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const people = useCursorPage(api.evidenceLibraries.queries.listOrganizationPeople, libraryId ? { libraryId, search: search || undefined } : "skip", PEOPLE_PAGE_SIZE);
  const stale = people.isStale || search !== query.trim();
  // Invited people aren't members yet, so the server doesn't know to leave them off.
  const shown = people.items
    .map((person) => ({ ...person, id: person.clerkUserId }))
    .filter((person) => !members.some((member) => member.email.toLowerCase() === person.email.toLowerCase()));
  return (
    <Command shouldFilter={false}>
      <CommandInput placeholder={t("searchNameOrEmail")} value={query} onValueChange={setQuery} />
      <CommandList>
        {!people.isLoading && !stale && !people.canNext && <CommandEmpty>{t("noPeopleAvailable")}</CommandEmpty>}
        <CommandGroup className={cn(stale && "opacity-60")}>
          {shown.map((person) => (
            <CommandItem key={person.id} value={person.id} disabled={stale} onSelect={() => onSelect(person)} className="gap-3 py-2.5">
              <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{person.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
              </span>
              {selected?.id === person.id && <Check className="size-4" />}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      {people.hasPages && (
        <div className="flex items-center justify-end gap-1 border-t p-1">
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("previousPeople")} disabled={!people.canPrevious} onClick={people.previous}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("nextPeople")} disabled={!people.canNext} onClick={people.next}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </Command>
  );
}

export function TeamAccess({
  scope,
  members,
  onMembersChange,
  libraryId,
  organization,
  onResend,
  readOnly = false,
}: {
  scope: "library" | "profile";
  members: AccessMember[];
  onMembersChange: (members: AccessMember[]) => Promise<void>;
  /** The library whose organization's members can be added; a profile has none. */
  libraryId?: Id<"evidenceLibraries">;
  /** The organization a library is in, whose other members view it; none for a library in a person's own workspace. */
  organization?: WorkspaceLook;
  onResend: (member: AccessMember) => Promise<void>;
  /** For everyone but its owners: who has access and their roles, with nothing to add, change or remove. */
  readOnly?: boolean;
}) {
  const tLabels = useTranslations("libraryTeamAccess");
  const t = useTranslations("libraryTeamAccess");
  const isProfile = scope === "profile";
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  async function runChange(action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try { await action(); }
    finally { pendingRef.current = false; setPending(false); }
  }
  const setMembers = (change: (current: AccessMember[]) => AccessMember[]) =>
    runChange(() => onMembersChange(change(members)));
  const [invite, setInvite] = useState(false),
    [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Creator"),
    [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<string | null>(null),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [addMode, setAddMode] = useState<"existing" | "new" | "organization">(scope === "profile" ? "new" : "existing");
  // The organizations its owner can share it with straight away (#1091).
  const grantable = useProtectedQuery(api.evidenceLibraries.organizationGrants.grantable, libraryId && !isProfile && !readOnly ? { libraryId } : "skip").data?.page ?? [];
  const [organizationPick, setOrganizationPick] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Pick<AccessMember, "id" | "name" | "email" | "imageUrl"> | null>(null);
  const convex = useConvex();
  const [view, setView] = useState<"members" | "invitations">("members");
  const [rolesOpen, setRolesOpen] = useState(false);
  const filtered = members.filter((member) =>
    `${member.name} ${member.email}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const updateRole = (id: string, role: Role) =>
    setMembers((current) =>
      current.map((member) =>
        member.id === id ? { ...member, role } : member,
      ),
    ).catch((error: unknown) => setNotice(getErrorMessage(error, tLabels("unableToChangeRole"))));
  function people(
    list: AccessMember[],
    emptyMessage = tLabels("noMembersInThisRoleYet"),
  ) {
    if (!list.length)
      return (
        <EmptyList>{search ? t("noMatchingPeople") : emptyMessage}</EmptyList>
      );
    return (
      <ul className="divide-y divide-border-subtle">
        {list.map((member) => (
          <li key={member.id} className="px-4 py-4 hover:bg-muted">
            <div className="flex flex-wrap items-center gap-3">
              {member.organization ? <WorkspaceTile workspace={member.organization} size="row" /> : member.invited ? <EmailAvatar /> : <IdentityAvatar name={member.name} imageUrl={member.imageUrl} className="size-9" />}
              {/* At least 10rem for who it is: on a phone the role and its menu go to the next line rather than squeeze the name away. */}
              <div className="min-w-0 flex-[1_1_10rem]">
                <PersonName name={member.name} you={member.you === true} className="text-sm font-medium" />
                <p className="truncate text-xs text-muted-foreground">
                  {member.organization ? t("everyoneInIt") : member.toOrganization ? t("forTheirOrganization", { email: member.email }) : member.email}
                </p>
                {member.invited && member.delivery === "failed" && <p className="text-xs text-destructive">{t("invitationNotDelivered")}</p>}
              </div>
              {readOnly || (isProfile && member.role === "Editor") || member.role === "Owner" ? (
                <RoleLabel role={member.role === "Owner" ? "owner" : member.role === "Creator" ? "creator" : "editor"} className="w-36 gap-2 px-3">
                  {tLabels(`roleNames.${member.role}`)}
                </RoleLabel>
              ) : (
                <RoleSelect
                  disabled={pending}
                  label={t("roleFor", { name: member.name })}
                  value={member.role}
                  onChange={(value) => updateRole(member.id, value)}
                />
              )}
              {!readOnly && member.role !== "Owner" && !member.protected ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      disabled={pending}
                      aria-label={t("actionsFor", { name: member.name })}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {member.invited && (
                      <DropdownMenuItem
                        onSelect={() => {
                          void runChange(() => onResend(member)).then(() => setNotice(tLabels("invitationSentTo", { email: member.email }))).catch((error: unknown) => setNotice(getErrorMessage(error, tLabels("unableToSendInvitation"))));
                        }}
                      >
                        <RotateCcw />
                        {t("resendInvitation")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setRemoving(member.id)}
                    >
                      <Trash2 />
                      {member.invited
                        ? t("cancelInvitation")
                        : t(scope === "library" ? "removeFromLibrary" : "removeFromProfile")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="size-8" aria-hidden="true" />
              )}
            </div>
            {removing === member.id && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <p className="text-xs">
                  {member.invited
                    ? t("cancelThisInvitation")
                    : member.organization
                      ? t("removeThisOrganization")
                      : isProfile
                      ? t("removeAccessToThisAuthorProfile")
                      : t("removeFromThisLibraryOrganizationMembership")}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRemoving(null)}
                  >
                    {t("keep")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={async () => {
                    try {
                      await setMembers((current) =>
                        current.filter((m) => m.id !== member.id),
                      );
                      setRemoving(null);
                      setNotice(
                        member.invited
                          ? tLabels("invitationCancelled")
                          : tLabels(scope === "library" ? "removedFromLibrary" : "removedFromProfile"),
                      );
                    } catch (error) { setNotice(getErrorMessage(error, tLabels("unableToRemoveAccess"))); }
                    }}
                  >
                    {member.invited
                      ? t("cancelInvitation")
                      : t(scope === "library" ? "removeFromLibrary" : "removeFromProfile")}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Dialog open={invite} onOpenChange={(open) => { if (!pending) setInvite(open); }}>
      <SectionCard
        id={isProfile ? "sec-profile-access" : "sec-team"}
        icon={Users}
        title={isProfile ? t("profileAccess") : t("team")}
        description={
          isProfile
            ? t("theOwnerManagesAccessEditorsCan")
            : readOnly
              ? t("whoWorksOnIt")
              : t("manageAccessToThisLibrary")
        }
        bodyClassName="space-y-0 p-0"
        aside={readOnly ? undefined : (
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                setError("");
                setSelected(null);
                setPickerOpen(false);
              }}
            >
              <Plus />
              {isProfile ? t("addEditor") : t("addMember")}
            </Button>
          </DialogTrigger>
        )}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {isProfile ? t("inviteProfileEditor") : t("addMember")}
            </DialogTitle>
            <DialogDescription>{t(scope === "library" ? "whoManagesLibrary" : "whoManagesProfile")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pendingRef.current) return;
              try {
              if (addMode === "organization" && organizationPick !== ANOTHER) {
                const chosen = grantable.find((row) => row.organizationId === organizationPick);
                if (!chosen) {
                  setError(tLabels("chooseAnOrganization"));
                  return;
                }
                const organizationLook = { kind: "organization" as const, name: chosen.name, ...(chosen.imageUrl ? { imageUrl: chosen.imageUrl } : {}), ...(chosen.workspaceId ? { workspaceId: chosen.workspaceId } : {}), ...(chosen.colour ? { colour: chosen.colour } : {}) };
                await setMembers((current) => [...current, { id: chosen.organizationId, name: chosen.name, email: "", role, invited: false, organization: organizationLook }]);
                setNotice(tLabels("addedToLibrary", { name: chosen.name }));
                setInvite(false);
                setOrganizationPick("");
                setView("members");
                setSearch("");
                return;
              }
              if (addMode === "existing") {
                const person = selected;
                if (!person) {
                  setError(
                    isProfile
                      ? tLabels("chooseAPerson2")
                      : tLabels("chooseAnOrganizationMember"),
                  );
                  return;
                }
                await setMembers((current) => [
                  ...current,
                  {
                    ...person,
                    role: isProfile ? "Editor" : role,
                    invited: false,
                  },
                ]);
                setNotice(
                  tLabels(scope === "library" ? "addedToLibrary" : "addedToProfile", { name: person.name }),
                );
                setInvite(false);
                setSelected(null);
                setView("members");
                setSearch("");
                return;
              }
              // An organization's admin may already be on the team: the invitation is for their organization.
              if (addMode === "new" && libraryId && (await convex.query(api.evidenceLibraries.queries.isOrganizationPerson, { libraryId, email }))) {
                setError(
                  isProfile
                    ? tLabels("thisPersonIsAlreadyListedChoose")
                    : tLabels("thisPersonIsAlreadyListedChoose2"),
                );
                return;
              }
              if (
                members.some(
                  (m) => m.invited && m.email.toLowerCase() === email.trim().toLowerCase(),
                ) || (addMode === "new" && members.some((m) => m.email.toLowerCase() === email.trim().toLowerCase()))
              ) {
                setError(
                  tLabels("thisEmailAlreadyHasAccessOr"),
                );
                return;
              }
              await setMembers((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  name: email.trim().split("@")[0]!,
                  email: email.trim(),
                  role: isProfile ? "Editor" : role,
                  invited: true,
                  ...(addMode === "organization" ? { toOrganization: true } : {}),
                },
              ]);
              setOrganizationPick("");
              setNotice(
                tLabels("invitationSentTo", { email: email.trim() }),
              );
              setEmail("");
              setInvite(false);
              setView("invitations");
              setSearch("");
              } catch (error) { setError(getErrorMessage(error, tLabels("unableToAddMember"))); }
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div
                className="flex flex-wrap items-center gap-1"
                aria-label={t("addMemberMethod")}
              >
                {(isProfile ? ["new"] as const : ["existing", "new", "organization"] as const).map((mode) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    key={mode}
                    type="button"
                    aria-pressed={addMode === mode}
                    className={cn(
                      "gap-2 text-muted-foreground",
                      addMode === mode && "bg-muted text-foreground",
                    )}
                    onClick={() => {
                      setAddMode(mode);
                      setError("");
                    }}
                  >
                    {mode === "existing" ? (
                      <Users className="size-3.5" />
                    ) : mode === "organization" ? (
                      <Building2 className="size-3.5" />
                    ) : (
                      <Mail className="size-3.5" />
                    )}
                    {mode === "existing"
                      ? isProfile
                        ? t("existingPerson")
                        : t("fromOrganization")
                      : mode === "organization"
                        ? t("anOrganization")
                        : t("inviteByEmail")}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                {addMode === "organization" ? (
                  <div className="space-y-2">
                    <Select value={organizationPick} onValueChange={(value) => { setOrganizationPick(value); setError(""); }}>
                      <SelectTrigger aria-label={t("organizationLabel")} className="h-10 w-full bg-background">
                        <SelectValue placeholder={t("chooseAnOrganization")} />
                      </SelectTrigger>
                      <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
                        {grantable.map((row) => (
                          <SelectItem key={row.organizationId} value={row.organizationId} textValue={row.name}>
                            <WorkspaceTile workspace={{ kind: "organization", name: row.name, ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}), ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}), ...(row.colour ? { colour: row.colour } : {}) }} size="xxs" />
                            {row.name}
                          </SelectItem>
                        ))}
                        <SelectItem value={ANOTHER} textValue={t("anotherOrganization")}>
                          <Mail className="size-3.5 text-muted-foreground" />
                          {t("anotherOrganization")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {organizationPick === ANOTHER && (
                      <Input
                        type="email"
                        required
                        aria-label={t("adminEmail")}
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          setError("");
                        }}
                        placeholder={t("adminEmail")}
                        className="h-10 bg-background"
                      />
                    )}
                  </div>
                ) : addMode === "existing" ? (
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={pickerOpen}
                        aria-label={
                          isProfile ? t("person") : t("organizationMember")
                        }
                        className="h-10 w-full justify-between gap-2 bg-background px-3 font-normal shadow-none"
                      >
                        {selected ? (
                          <span className="flex min-w-0 items-center gap-2">
                            <IdentityAvatar name={selected.name} imageUrl={selected.imageUrl} className="size-6" />
                            <span className="truncate">{selected.name}</span>
                            <span className="hidden truncate text-xs text-muted-foreground lg:inline">
                              {selected.email}
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Search className="size-4" />
                            {t("chooseAPerson")}
                          </span>
                        )}
                        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <OrganizationPeople
                        libraryId={libraryId}
                        members={members}
                        selected={selected}
                        onSelect={(person) => {
                          setSelected(person);
                          setPickerOpen(false);
                          setError("");
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Input
                    type="email"
                    required
                    aria-label={t("emailAddress")}
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError("");
                    }}
                    placeholder={t("nameOrganisationOrg")}
                    className="h-10 bg-background"
                  />
                )}
              </div>
              {!isProfile && (
                <RoleSelect
                  label={t("libraryRole")}
                  value={role}
                  onChange={setRole}
                  className="h-10 data-[size=sm]:h-10"
                />
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isProfile
                ? t("editorsCanEditProfileDetailsAnd")
                : addMode === "organization"
                  ? t(organizationPick === ANOTHER ? "theirAdminAccepts" : "organizationGetsIt")
                  : addMode === "existing"
                  ? t("accessAppliesToThisLibraryOnly")
                  : t("theyLlReceiveAccessToThis")}
            </p>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter className="border-t border-border-subtle pt-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("cancel")}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={pending || (addMode === "existing" && !selected) || (addMode === "organization" && !organizationPick)}
                aria-busy={pending}
              >
                {addMode === "existing" || (addMode === "organization" && organizationPick !== ANOTHER) ? <Plus /> : <Mail />}
                {addMode === "existing" || (addMode === "organization" && organizationPick !== ANOTHER) ? t(scope === "library" ? "addToLibrary" : "addToProfile") : t("sendInvitation")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
        {notice && (
          <div
            role="status"
            className="flex items-center gap-3 border-b border-border-subtle bg-inset px-4 py-2 text-xs text-muted-foreground"
          >
            <span className="flex-1">{notice}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("dismissMemberStatus")}
              onClick={() => setNotice("")}
              className="size-6"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
        {!isProfile && (
          <div className="border-b border-border-subtle bg-inset">
            <div className="px-4 pt-4">
              {/* A community in a person's own workspace has them as its owner, and no organization. */}
              <h4 className="text-xs font-medium">{organization ? t("organizationOwners") : t("roleNames.Owner")}</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {organization ? t("accessToAllLibrariesManagedIn") : t("ownWorkspaceOwner")}
              </p>
            </div>
            {people(members.filter((member) => member.role === "Owner"))}
          </div>
        )}
        {!isProfile && organization && (
          // The rest of the organization views the library until an owner gives them a role (#653).
          <div className="border-b border-border-subtle bg-inset">
            <div className="px-4 pt-4">
              <h4 className="text-xs font-medium">{t("everyoneElseInTheOrganization")}</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {readOnly ? t("viewersUntilAnOwner") : t("viewersUntilYouAddThemBelow")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 px-4 py-4">
              <WorkspaceTile workspace={organization} size="row" />
              {/* As every team row: on a phone the role goes to the next line rather than squeeze the name away. */}
              <div className="min-w-0 flex-[1_1_10rem]">
                <p className="truncate text-sm font-medium">{t("everyoneIn", { name: organization.name })}</p>
                <p className="truncate text-xs text-muted-foreground">{t("everyoneWithoutARoleInThis")}</p>
              </div>
              <RoleLabel role="view" className="w-36 gap-2 px-3">
                {tLabels("roleNames.Viewer")}
              </RoleLabel>
              <span className="size-8" aria-hidden="true" />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-1" aria-label={t("teamView")}>
            {/* Invitations are its owners' to see. */}
            {(readOnly ? ["members"] as const : ["members", "invitations"] as const).map((tab) => {
              const Icon = tab === "members" ? Users : Mail;
              const count = members.filter(
                (member) =>
                  (isProfile || member.role !== "Owner") &&
                  member.invited === (tab === "invitations"),
              ).length;
              return (
                <Button
                  key={tab}
                  variant="ghost"
                  size="sm"
                  aria-pressed={view === tab}
                  onClick={() => {
                    setView(tab);
                    setRemoving(null);
                  }}
                  className={cn(
                    "gap-2 text-muted-foreground",
                    view === tab && "bg-muted text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {tab === "members"
                    ? isProfile
                      ? t("profileMembers")
                      : t("libraryMembers")
                    : t("invitations")}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-48">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t("searchTeam")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("findAPerson")}
              className="h-8 border-transparent bg-inset ps-8 text-xs shadow-none"
            />
          </div>
        </div>
        {view === "invitations" && (
          <p className="flex items-center gap-2 border-b border-border-subtle px-4 py-3 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            {t(scope === "library" ? "acceptingGrantsLibrary" : "acceptingGrantsProfile")}
          </p>
        )}
        {people(
          filtered.filter(
            (member) =>
              (isProfile || member.role !== "Owner") &&
              member.invited === (view === "invitations"),
          ),
          view === "invitations"
            ? tLabels("noPendingInvitations")
            : tLabels("noMembersYet"),
        )}
        {!isProfile && (
          <div className="border-t border-border-subtle px-4 py-3 text-xs text-muted-foreground">
            <Disclosure open={rolesOpen} onOpenChange={setRolesOpen} label={t("aboutLibraryRoles")}>
            <dl className={cn("grid gap-3 pb-1 pt-3", organization ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
              {(["Owner", "Editor", "Creator", ...(organization ? (["Viewer"] as const) : [])] as const).map((role) => (
                <div key={role}>
                  <dt className="mb-1">
                    <RoleLabel role={role === "Owner" ? "owner" : role === "Viewer" ? "view" : role === "Creator" ? "creator" : "editor"} className="font-medium text-foreground">
                      {tLabels(`roleNames.${role}`)}
                    </RoleLabel>
                  </dt>
                  <dd className="leading-relaxed">{tLabels(`roleHints.${role}`)}</dd>
                </div>
              ))}
            </dl>
            </Disclosure>
          </div>
        )}
      </SectionCard>
    </Dialog>
  );
}
function RoleSelect({
  id,
  label,
  value,
  onChange,
  className,
  disabled,
}: {
  disabled?: boolean;
  id?: string;
  className?: string;
  label: string;
  value: Role;
  onChange: (role: Role) => void;
}) {
  const tLabels = useTranslations("libraryTeamAccess");
  const t = useTranslations("libraryTeamAccess");
  return (
    <Select disabled={disabled} value={value} onValueChange={(value) => onChange(value as Role)}>
      <SelectTrigger
        id={id}
        aria-label={label}
        size="sm"
        className={cn(
          "w-fit min-w-36 shrink-0 border-transparent bg-inset shadow-none hover:bg-muted",
          className,
        )}
      >
        {value === "Editor" ? <ROLE_ICONS.editor className="size-3.5 text-muted-foreground" /> : <ROLE_ICONS.creator className="size-3.5 text-muted-foreground" />}
        <SelectValue className="shrink-0">{tLabels(`roleNames.${value}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent className="w-72" position="popper">
        <SelectItem value="Editor" textValue={tLabels("roleNames.Editor")}>
          <div className="py-1">
            <span className="font-medium">{tLabels("roleNames.Editor")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t("reviewPublishAndManageLibraryContent")}
            </span>
          </div>
        </SelectItem>
        <SelectItem value="Creator" textValue={tLabels("roleNames.Creator")}>
          <div className="py-1">
            <span className="font-medium">{tLabels("roleNames.Creator")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t("editItemsAndSubmitWorkFor")}
            </span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
