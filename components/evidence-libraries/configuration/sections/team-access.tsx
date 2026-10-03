"use client";

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
  ShieldCheck,
  Crown,
  PenLine,
  Clock3,
  ChevronsUpDown,
  Check,
} from "@/components/icons";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
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
};
const roleHint: Record<Role, string> = {
  Owner:
    "Inherited from the organization. Manage all its libraries and their teams.",
  Editor: "Review and publish items. Manage library content.",
  Creator: "Create and edit items, upload files and submit for review.",
};

export function TeamAccess({
  scope,
  members,
  onMembersChange,
  organizationPeople,
  onResend,
}: {
  scope: "library" | "profile";
  members: AccessMember[];
  onMembersChange: (members: AccessMember[]) => Promise<void>;
  organizationPeople: Pick<AccessMember, "id" | "name" | "email" | "imageUrl">[];
  onResend: (member: AccessMember) => Promise<void>;
}) {
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
  const [addMode, setAddMode] = useState<"existing" | "new">(scope === "profile" ? "new" : "existing");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState("");
  const availablePeople = organizationPeople.filter(
    (person) =>
      !members.some(
        (member) => member.email.toLowerCase() === person.email.toLowerCase(),
      ),
  );
  const selected = availablePeople.find(
    (person) => person.id === selectedPerson,
  );
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
    ).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to change role"));
  function people(
    list: AccessMember[],
    emptyMessage = "No members in this role yet.",
  ) {
    if (!list.length)
      return (
        <EmptyList>{search ? "No matching people." : emptyMessage}</EmptyList>
      );
    return (
      <ul className="divide-y divide-border/50">
        {list.map((member) => (
          <li key={member.id} className="px-4 py-4 hover:bg-muted/20">
            <div className="flex flex-wrap items-center gap-3">
              <IdentityAvatar name={member.name} imageUrl={member.imageUrl} className="size-10 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
                {member.invited && member.delivery === "failed" && <p className="text-xs text-destructive">Invitation not delivered</p>}
              </div>
              {isProfile && member.role === "Editor" ? (
                <span className="flex w-36 items-center gap-2 px-3 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  Editor
                </span>
              ) : member.role === "Owner" ? (
                <span className="flex w-36 items-center gap-2 px-3 text-xs text-muted-foreground">
                  <Crown className="size-3.5" />
                  Owner
                </span>
              ) : (
                <RoleSelect
                  disabled={pending}
                  label={`Role for ${member.name}`}
                  value={member.role}
                  onChange={(value) => updateRole(member.id, value)}
                />
              )}
              {member.role !== "Owner" && !member.protected ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      disabled={pending}
                      aria-label={`Actions for ${member.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {member.invited && (
                      <DropdownMenuItem
                        onSelect={() => {
                          void runChange(() => onResend(member)).then(() => setNotice(`Invitation sent to ${member.email}.`)).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to send invitation"));
                        }}
                      >
                        <RotateCcw />
                        Resend invitation
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setRemoving(member.id)}
                    >
                      <Trash2 />
                      {member.invited
                        ? "Cancel invitation"
                        : `Remove from ${scope}`}
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
                    ? "Cancel this invitation?"
                    : isProfile
                      ? "Remove access to this author profile?"
                      : "Remove from this library? Organization membership and access to other libraries stay unchanged."}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRemoving(null)}
                  >
                    Keep
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
                          ? "Invitation cancelled."
                          : `Removed from this ${scope}.`,
                      );
                    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to remove access"); }
                    }}
                  >
                    {member.invited
                      ? "Cancel invitation"
                      : `Remove from ${scope}`}
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
        title={isProfile ? "Profile access" : "Team"}
        description={
          isProfile
            ? "The owner manages access. Editors can edit this profile."
            : "Manage access to this library."
        }
        bodyClassName="space-y-0 p-0"
        aside={
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                setError("");
                setSelectedPerson("");
                setPickerOpen(false);
              }}
            >
              <Plus />
              {isProfile ? "Add editor" : "Add member"}
            </Button>
          </DialogTrigger>
        }
      >
        <DialogContent showCloseButton={false} className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {isProfile ? "Invite profile editor" : "Add member"}
            </DialogTitle>
            <DialogDescription>
              Choose who can manage this {scope}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pendingRef.current) return;
              try {
              if (addMode === "existing") {
                const person = availablePeople.find(
                  (person) => person.id === selectedPerson,
                );
                if (!person) {
                  setError(
                    isProfile
                      ? "Choose a person."
                      : "Choose an organization member.",
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
                  `${person.name} added to this ${scope}.`,
                );
                setInvite(false);
                setSelectedPerson("");
                setView("members");
                setSearch("");
                return;
              }
              if (
                organizationPeople.some(
                  (person) =>
                    person.email.toLowerCase() === email.trim().toLowerCase(),
                )
              ) {
                setError(
                  isProfile
                    ? "This person is already listed. Choose them under Existing person."
                    : "This person is already listed. Choose them under From organization.",
                );
                return;
              }
              if (
                members.some(
                  (m) => m.email.toLowerCase() === email.trim().toLowerCase(),
                )
              ) {
                setError(
                  "This email already has access or a pending invitation.",
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
                },
              ]);
              setNotice(
                `Invitation sent to ${email.trim()}.`,
              );
              setEmail("");
              setInvite(false);
              setView("invitations");
              setSearch("");
              } catch (error) { setError(error instanceof Error ? error.message : "Unable to add member"); }
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div
                className="flex flex-wrap items-center gap-1"
                aria-label="Add member method"
              >
                {(isProfile ? ["new"] as const : ["existing", "new"] as const).map((mode) => (
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
                    ) : (
                      <Mail className="size-3.5" />
                    )}
                    {mode === "existing"
                      ? isProfile
                        ? "Existing person"
                        : "From organization"
                      : "Invite by email"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                {addMode === "existing" ? (
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={pickerOpen}
                        aria-label={
                          isProfile ? "Person" : "Organization member"
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
                            Choose a person
                          </span>
                        )}
                        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Search name or email" />
                        <CommandList>
                          <CommandEmpty>No people available.</CommandEmpty>
                          <CommandGroup>
                            {availablePeople.map((person) => (
                              <CommandItem
                                key={person.id}
                                value={`${person.name} ${person.email}`}
                                onSelect={() => {
                                  setSelectedPerson(person.id);
                                  setPickerOpen(false);
                                  setError("");
                                }}
                                className="gap-3 py-2.5"
                              >
                                <IdentityAvatar name={person.name} imageUrl={person.imageUrl} className="size-8" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">
                                    {person.name}
                                  </span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {person.email}
                                  </span>
                                </span>
                                {selectedPerson === person.id && (
                                  <Check className="size-4" />
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Input
                    type="email"
                    required
                    aria-label="Email address"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError("");
                    }}
                    placeholder="name@organisation.org"
                    className="h-10 bg-background"
                  />
                )}
              </div>
              {!isProfile && (
                <RoleSelect
                  label="Library role"
                  value={role}
                  onChange={setRole}
                  className="h-10 data-[size=sm]:h-10"
                />
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isProfile
                ? "Editors can edit profile details and select publications."
                : addMode === "existing"
                  ? "Access applies to this library only."
                  : "They’ll receive access to this library only. Organization membership is unchanged."}
            </p>
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter className="border-t border-border/50 pt-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={pending || (addMode === "existing" && !selectedPerson)}
                aria-busy={pending}
              >
                {addMode === "existing" ? <Plus /> : <Mail />}
                {addMode === "existing" ? `Add to ${scope}` : "Send invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
        {notice && (
          <div
            role="status"
            className="flex items-center gap-3 border-b border-border/50 bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
          >
            <span className="flex-1">{notice}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss member status"
              onClick={() => setNotice("")}
              className="size-6"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
        {!isProfile && (
          <div className="border-b border-border/50 bg-muted/10">
            <div className="px-4 pt-4">
              <h4 className="text-xs font-medium">Organization owners</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Access to all libraries. Managed in organization settings.
              </p>
            </div>
            {people(members.filter((member) => member.role === "Owner"))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-1" aria-label="Team view">
            {(["members", "invitations"] as const).map((tab) => {
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
                      ? "Profile members"
                      : "Library members"
                    : "Invitations"}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search team"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a person…"
              className="h-8 border-transparent bg-muted/40 pl-8 text-xs shadow-none"
            />
          </div>
        </div>
        {view === "invitations" && (
          <p className="flex items-center gap-2 border-b border-border/50 px-4 py-3 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            Accepting grants access to this {scope} only.
          </p>
        )}
        {people(
          filtered.filter(
            (member) =>
              (isProfile || member.role !== "Owner") &&
              member.invited === (view === "invitations"),
          ),
          view === "invitations"
            ? "No pending invitations."
            : "No members yet.",
        )}
        {!isProfile && (
          <div className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
            <Disclosure open={rolesOpen} onOpenChange={setRolesOpen} label="About library roles">
            <dl className="grid gap-3 pb-1 pt-3 sm:grid-cols-3">
              {(["Owner", "Editor", "Creator"] as const).map((role) => (
                <div key={role}>
                  <dt className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                    {role === "Owner" ? (
                      <Crown className="size-3.5" />
                    ) : role === "Creator" ? (
                      <PenLine className="size-3.5" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    {role}
                  </dt>
                  <dd className="leading-relaxed">{roleHint[role]}</dd>
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
  return (
    <Select disabled={disabled} value={value} onValueChange={(value) => onChange(value as Role)}>
      <SelectTrigger
        id={id}
        aria-label={label}
        size="sm"
        className={cn(
          "w-fit min-w-36 shrink-0 border-transparent bg-muted/40 shadow-none hover:bg-muted",
          className,
        )}
      >
        {value === "Editor" ? (
          <ShieldCheck className="size-3.5 text-muted-foreground" />
        ) : (
          <PenLine className="size-3.5 text-muted-foreground" />
        )}
        <SelectValue className="shrink-0">{value}</SelectValue>
      </SelectTrigger>
      <SelectContent className="w-72" position="popper">
        <SelectItem value="Editor" textValue="Editor">
          <div className="py-1">
            <span className="font-medium">Editor</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Review, publish and manage library content.
            </span>
          </div>
        </SelectItem>
        <SelectItem value="Creator" textValue="Creator">
          <div className="py-1">
            <span className="font-medium">Creator</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Edit items and submit work for review.
            </span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
