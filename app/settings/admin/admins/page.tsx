"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Loader2, Mail, Plus, RotateCcw, Search, Trash2, UserRound } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { TooltipHint } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { Enter, LIST, Paged, pagerOf, Segmented, Zone } from "@/components/settings/parts";

const PER_PAGE = 8;

export default function AdminsPage() {
  const t = useTranslations("settingsAdmin.admins");
  const tc = useTranslations("common");
  const { data: admins } = useProtectedQuery(api.admins.queries.list, {});
  const remove = useMutation(api.admins.mutations.remove);
  const resend = useAction(api.admins.invitations.resend);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<Id<"admins"> | null>(null);
  const [busy, setBusy] = useState<Id<"admins"> | null>(null);

  if (!admins) return <Enter ready={false}>{null}</Enter>;
  const q = query.trim().toLowerCase();
  const matches = admins.filter((a) => !q || `${a.name ?? ""} ${a.email}`.toLowerCase().includes(q));
  const pager = pagerOf(matches.length, PER_PAGE, page, setPage);
  const shown = matches.slice((pager.page - 1) * PER_PAGE, pager.page * PER_PAGE);

  const run = async (adminId: Id<"admins">, action: () => Promise<unknown>, done?: string) => {
    setBusy(adminId);
    try {
      await action();
      setConfirm(null);
      if (done) toast.success(done);
    } catch (error) {
      toast.error(getErrorMessage(error, tc("somethingWentWrong")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Enter ready>
      <Zone label={t("title")} aside={<AddAdmin />}>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder={t("search")}
              aria-label={t("search")}
              className="h-11 rounded-2xl border border-border/60 bg-muted/40 pl-11"
            />
          </div>
          <Paged pager={pager} rowHeight={65} label={t("admins")}>
            <ul className={LIST}>
              {shown.map((a) => (
                <li key={a._id} className="flex items-center gap-3 p-3">
                  {a.joined ? (
                    <IdentityAvatar name={a.name ?? a.email} imageUrl={a.imageUrl} className="size-10 rounded-xl" />
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
                      <Mail className="size-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      {a.joined ? (a.name ?? a.email) : a.email}
                      {a.you ? <span className="text-xs font-normal text-primary">{t("you")}</span> : null}
                    </p>
                    <p className={a.delivery === "failed" ? "truncate text-xs text-destructive" : "truncate text-xs text-muted-foreground"}>
                      {a.joined ? a.email : a.delivery === "failed" ? t("notDelivered") : t("invited")}
                    </p>
                  </div>
                  <div className="flex shrink-0 justify-end">
                    {a.you ? null : confirm === a._id ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                          {tc("cancel")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy === a._id}
                          onClick={() => run(a._id, () => remove({ adminId: a._id }))}
                        >
                          {busy === a._id ? <Loader2 className="animate-spin" /> : null}
                          {a.joined ? t("remove") : t("cancelInvite")}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center">
                        {!a.joined ? (
                          <TooltipHint label={t("resend")}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground"
                              aria-label={t("resendTo", { email: a.email })}
                              disabled={busy === a._id}
                              onClick={() => run(a._id, () => resend({ adminId: a._id }), t("inviteSent", { email: a.email }))}
                            >
                              {busy === a._id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                            </Button>
                          </TooltipHint>
                        ) : null}
                        <TooltipHint label={a.joined ? t("remove") : t("cancelInvite")}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={a.joined ? t("removeName", { name: a.name ?? a.email }) : t("cancelInviteFor", { email: a.email })}
                            onClick={() => setConfirm(a._id)}
                          >
                            <Trash2 />
                          </Button>
                        </TooltipHint>
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {matches.length === 0 ? <li className="py-10 text-center text-sm text-muted-foreground">{t("noMatches")}</li> : null}
            </ul>
          </Paged>
        </div>
      </Zone>
    </Enter>
  );
}

/** Add an existing user, or invite an email that becomes an admin on first sign-in. */
function AddAdmin() {
  const t = useTranslations("settingsAdmin.admins");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"user" | "email">("user");
  const [picked, setPicked] = useState<{ _id: Id<"users">; email: string; name?: string; imageUrl?: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: candidates } = useProtectedQuery(api.admins.queries.candidates, open && mode === "user" ? { search } : "skip");
  const addUser = useMutation(api.admins.mutations.addUser);
  const invite = useAction(api.admins.invitations.invite);
  const canSubmit = !pending && (mode === "user" ? picked !== null : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      if (mode === "user" && picked) {
        await addUser({ userId: picked._id });
      } else {
        await invite({ email: email.trim() });
      }
      setOpen(false);
      setPicked(null);
      setEmail("");
      setSearch("");
    } catch (e) {
      setError(getErrorMessage(e, tc("somethingWentWrong")));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-7">
          <Plus /> {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("add")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <Segmented
            className="self-start"
            label={t("how")}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { id: "user", label: t("existingUser"), icon: UserRound },
              { id: "email", label: t("inviteByEmail"), icon: Mail },
            ]}
          />
          {mode === "user" ? (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-expanded={pickerOpen} className="h-11 w-full justify-between rounded-xl px-3 font-normal">
                  {picked ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <IdentityAvatar name={picked.name ?? picked.email} imageUrl={picked.imageUrl} className="size-6" />
                      <span className="truncate">{picked.name ?? picked.email}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t("chooseUser")}</span>
                  )}
                  <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
                {/* The server searches by email, so the list isn't filtered again here. */}
                <Command shouldFilter={false}>
                  <CommandInput placeholder={t("searchEmail")} value={search} onValueChange={setSearch} />
                  <CommandList>
                    <CommandEmpty>{candidates === undefined ? tc("loading") : t("noUsers")}</CommandEmpty>
                    <CommandGroup>
                      {(candidates ?? []).map((u) => (
                        <CommandItem
                          key={u._id}
                          value={u._id}
                          onSelect={() => {
                            setPicked(u);
                            setPickerOpen(false);
                          }}
                          className="gap-3 py-2"
                        >
                          <IdentityAvatar name={u.name ?? u.email} imageUrl={u.imageUrl} className="size-8" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{u.name ?? u.email}</span>
                            {u.name ? <span className="block truncate text-xs text-muted-foreground">{u.email}</span> : null}
                          </span>
                          {picked?._id === u._id ? <Check className="size-4" /> : null}
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
              autoFocus
              aria-label={t("email")}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="name@organisation.org"
              className="h-11 rounded-xl"
            />
          )}
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {tc("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {mode === "user" ? t("add") : t("sendInvite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
