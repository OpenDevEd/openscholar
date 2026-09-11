"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import { CalendarDays, Clock3, Repeat2, Globe2, Mail, Send, TimerReset } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "../section-card";
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
      else if (result.status === "empty") toast.info("No new publications. Nothing was sent.");
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
  try {new Intl.DateTimeFormat("en", {timeZone: schedule.timezone});} catch {timezoneError = "Enter a valid timezone, such as Europe/London.";}
  return <FieldGroup title={<span className="inline-flex items-center gap-2"><Mail className="size-4 text-primary" />Email updates</span>}>
    <ToggleRow label="Reader subscriptions" hint="Readers can choose new publications, library digests, or both. Empty editions are skipped." checked={notifications.enabled} onChange={enabled => patch(draft => {draft.notifications.enabled = enabled;return draft;})} />
    {notifications.enabled && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          : <Select value={String(schedule.dayOfMonth)} onValueChange={value => setSchedule({...schedule, dayOfMonth: Number(value)})}><SelectTrigger id={id} className="w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{Array.from({length: 31}, (_, index) => <SelectItem key={index + 1} value={String(index + 1)}>{index + 1}</SelectItem>)}</SelectContent></Select>}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><Clock3 className="size-4 text-muted-foreground" />Time</span>} error={!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) ? "Choose a valid time." : null}>
        {(id, invalid) => <Input id={id} type="time" className="bg-background" value={schedule.time} aria-invalid={invalid || undefined} onChange={event => setSchedule({...schedule, time: event.target.value})} />}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><Globe2 className="size-4 text-muted-foreground" />Timezone</span>} error={timezoneError}>
        {(id, invalid) => <Input id={id} className="bg-background" value={schedule.timezone} placeholder="Europe/London" aria-invalid={invalid || undefined} onChange={event => setSchedule({...schedule, timezone: event.target.value})} />}
      </Field>
    </div>}
    {canSend && notifications.enabled && <PanelRow
      className="flex-col items-stretch sm:flex-row sm:items-center"
      title={<span className="inline-flex items-center gap-2"><TimerReset className="size-4 text-muted-foreground" />Manual digest</span>}
      hint="Includes new publications since the last digest. The next scheduled edition starts from this one."
      action={<Button type="button" variant="outline" className="w-full sm:w-auto" onClick={sendNow} disabled={sending}>
        {sending ? <Spinner className="size-4" /> : <Send className="size-4" />}
        {sending ? "Queuing digest" : "Send digest now"}
      </Button>}
    />}
  </FieldGroup>;
}
