"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import { BadgeCheck, BookOpen, CalendarDays, Check, ChevronDown, Clock3, Pause, PenLine, Repeat2, Globe2, Mail, Send, TimerReset } from "@/components/icons";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Field, hintId } from "../section-card";
import { FieldGroup, PanelRow, ToggleRow } from "../fields";
import type { SectionProps } from "../section-shell";

export function NotificationsFields({libraryId, draft, patch}: Pick<SectionProps, "libraryId" | "draft" | "patch">) {
  const canSend = useProtectedQuery(api.evidenceLibraries.digests.manual.available, {libraryId}).data === true;
  const send = useAction(api.evidenceLibraries.digests.manualActions.send);
  const [sending, setSending] = useState(false);
  async function sendNow() {
    if (sending) return;
    setSending(true);
    try {
      const result = await send({libraryId});
      if (result.status === "queued") toast.success(`Digest queued for ${result.publicationCount} ${result.publicationCount === 1 ? "publication" : "publications"}.`);
      else if (result.status === "empty") toast.info("No publications in the period. Nothing was sent.");
      else toast.error("Publish the library configuration with reader subscriptions enabled first.");
    } catch {
      toast.error("The digest request could not be confirmed. Try again; existing editions will not be sent twice.");
    } finally {
      setSending(false);
    }
  }
  const {notifications} = draft;
  const schedule = notifications.schedule;
  const setSchedule = (value: typeof schedule) => patch(draft => {draft.notifications.schedule = value;return draft;});
  let timezoneError: string | null = null;
  try {new Intl.DateTimeFormat("en", {timeZone: schedule.timezone});} catch {timezoneError = "Choose a timezone.";}
  return <FieldGroup title={<span className="inline-flex items-center gap-2"><Mail className="size-4 text-primary" />Email updates</span>}>
    <ToggleRow label="Reader subscriptions" hint="Readers can choose new publications, library digests, or both. Empty editions are skipped." checked={notifications.enabled} onChange={enabled => patch(draft => {draft.notifications.enabled = enabled;return draft;})} />
    {notifications.enabled && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Field className="sm:col-span-2 xl:col-span-4" label={<span className="inline-flex items-center gap-2"><BookOpen className="size-4 text-muted-foreground" />Digest covers</span>} hint={notifications.digestCovers === "published" ? "A publication without a full date belongs to no period." : "An older publication counts when it is new to the library."}>
        {id => <Select value={notifications.digestCovers} onValueChange={value => patch(draft => {draft.notifications.digestCovers = value === "added" ? "added" : "published";return draft;})}>
          <SelectTrigger id={id} aria-describedby={hintId(id)} className="w-full bg-background"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="published">Publications published in the period</SelectItem><SelectItem value="added">Publications added to the library in the period</SelectItem></SelectContent>
        </Select>}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><Repeat2 className="size-4 text-muted-foreground" />Frequency</span>}>
        {id => <Select value={schedule.frequency} onValueChange={frequency => setSchedule(frequency === "monthly"
          ? {frequency, dayOfMonth: 1, time: schedule.time, timezone: schedule.timezone}
          : {frequency: "weekly", weekday: 1, time: schedule.time, timezone: schedule.timezone})}>
          <SelectTrigger id={id} className="w-full bg-background"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
        </Select>}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" />{schedule.frequency === "weekly" ? "Day of the week" : "Day of the month"}</span>} hint={schedule.frequency === "monthly" && schedule.dayOfMonth > 28 ? "Shorter months use their last day." : undefined}>
        {id => schedule.frequency === "weekly"
          ? <Select value={String(schedule.weekday)} onValueChange={value => setSchedule({...schedule, weekday: Number(value)})}><SelectTrigger id={id} className="w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select>
          : <Select value={String(schedule.dayOfMonth)} onValueChange={value => setSchedule({...schedule, dayOfMonth: Number(value)})}><SelectTrigger id={id} aria-describedby={schedule.dayOfMonth > 28 ? hintId(id) : undefined} className="w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{Array.from({length: 31}, (_, index) => <SelectItem key={index + 1} value={String(index + 1)}>{index + 1}</SelectItem>)}</SelectContent></Select>}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><Clock3 className="size-4 text-muted-foreground" />Time</span>} error={!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) ? "Choose a valid time." : null}>
        {(id, invalid) => <Input id={id} type="time" className="bg-background" value={schedule.time} aria-invalid={invalid || undefined} onChange={event => setSchedule({...schedule, time: event.target.value})} />}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><Globe2 className="size-4 text-muted-foreground" />Timezone</span>} error={timezoneError}>
        {(id, invalid) => <TimezonePicker id={id} invalid={invalid} value={schedule.timezone} onChange={timezone => setSchedule({...schedule, timezone})} />}
      </Field>
    </div>}
    {notifications.enabled && <Field
      label={<span className="inline-flex items-center gap-2"><BadgeCheck className="size-4 text-muted-foreground" />Before a digest goes out</span>}
      hint={notifications.approval
        ? "It waits in the library's admin panel, where Creators can edit it and an Editor or Owner publishes it."
        : "It is published and emailed as soon as it is written. It can still be corrected in the library's admin panel."}
    >
      {id => <Select value={notifications.approval ? "editor" : "none"} onValueChange={value => patch(draft => {draft.notifications.approval = value === "editor";return draft;})}>
        <SelectTrigger id={id} aria-describedby={hintId(id)} className="w-full bg-background"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="editor">An editor approves it</SelectItem><SelectItem value="none">It is sent as AI wrote it</SelectItem></SelectContent>
      </Select>}
    </Field>}
    {notifications.enabled && <ToggleRow
      label={<span className="inline-flex items-center gap-2"><PenLine className="size-4 text-muted-foreground" />Name who checked it</span>}
      hint="On the digest, in the list of digests and in the email, with any note they wrote. A digest nobody checked says it was written by AI."
      checked={notifications.attribution}
      onChange={attribution => patch(draft => {draft.notifications.attribution = attribution;return draft;})}
    />}
    {notifications.enabled && <ToggleRow
      label={<span className="inline-flex items-center gap-2"><Pause className="size-4 text-muted-foreground" />Pause digests</span>}
      hint={notifications.pausedSince
        ? `Paused since ${new Date(notifications.pausedSince).toLocaleDateString("en-GB", {day: "numeric", month: "long"})}. The first digest after you resume covers everything since the last one, up to a month back.`
        : "New publication emails keep going out."}
      checked={notifications.pausedSince !== null}
      onChange={paused => patch(draft => {draft.notifications.pausedSince = paused ? new Date().toISOString() : null;return draft;})}
    />}
    {canSend && notifications.enabled && <PanelRow
      className="flex-col items-stretch sm:flex-row sm:items-center"
      title={<span className="inline-flex items-center gap-2"><TimerReset className="size-4 text-muted-foreground" />Manual digest</span>}
      hint="Covers the period since the last digest. The next scheduled edition starts from this one."
      action={<Button type="button" variant="outline" className="w-full sm:w-auto" onClick={sendNow} disabled={sending}>
        {sending ? <Spinner className="size-4" /> : <Send className="size-4" />}
        {sending ? "Queuing digest" : "Send digest now"}
      </Button>}
    />}
  </FieldGroup>;
}

// Chromium's ICU still lists these by their old names; Firefox and the IANA database use the new ones.
const currentNames: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara", "America/Buenos_Aires": "America/Argentina/Buenos_Aires", "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan", "America/Cordoba": "America/Argentina/Cordoba", "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis", "America/Jujuy": "America/Argentina/Jujuy", "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza", "Asia/Calcutta": "Asia/Kolkata", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh", "Atlantic/Faeroe": "Atlantic/Faroe", "Europe/Kiev": "Europe/Kyiv", "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei", "Pacific/Truk": "Pacific/Chuuk",
};

let timezones: {id: string; name: string; offset: string}[] | undefined;
function listTimezones() {
  // Etc/GMT+N zones have inverted signs and only Firefox lists them, so UTC stands in for all of them.
  timezones ??= ["UTC", ...new Set(Intl.supportedValuesOf("timeZone").filter(id => id !== "UTC" && !id.startsWith("Etc/")).map(id => currentNames[id] ?? id).sort())].map(id => ({
    id,
    name: id.replaceAll("_", " "),
    offset: new Intl.DateTimeFormat("en", {timeZone: id, timeZoneName: "shortOffset"}).formatToParts().find(part => part.type === "timeZoneName")?.value ?? "",
  }));
  return timezones;
}

function TimezonePicker({id, invalid, value, onChange}: {id: string; invalid: boolean; value: string; onChange: (timezone: string) => void}) {
  const [open, setOpen] = useState(false);
  const current = currentNames[value] ?? value;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-invalid={invalid || undefined} className="h-9 w-full justify-between bg-background px-3 font-normal hover:bg-background hover:text-foreground">
        <span className="truncate">{current.replaceAll("_", " ")}</span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" aria-label="Timezone" className="w-(--radix-popover-trigger-width) p-0">
      <Command label="Search city or region" defaultValue={current.replaceAll("_", " ")}>
        <CommandInput placeholder="Search city or region" />
        <CommandList>
          <CommandEmpty>No timezone found.</CommandEmpty>
          <CommandGroup>
            {listTimezones().map(timezone => <CommandItem key={timezone.id} value={timezone.name} keywords={[timezone.id]} onSelect={() => {onChange(timezone.id);setOpen(false);}}>
              <Check className={current === timezone.id ? "size-4" : "size-4 opacity-0"} />
              <span className="min-w-0 flex-1 truncate">{timezone.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timezone.offset}</span>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
