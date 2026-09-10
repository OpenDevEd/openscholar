"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import { CalendarDays, Clock3, Globe2, Mail, Send, TimerReset } from "lucide-react";
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
  const weekly = notifications.weekly;
  const setWeekly = (value: Partial<typeof weekly>) => patch(draft => {draft.notifications.weekly = {...draft.notifications.weekly, ...value};return draft;});
  let timezoneError: string | null = null;
  try {new Intl.DateTimeFormat("en", {timeZone: weekly.timezone});} catch {timezoneError = "Enter a valid timezone, such as Europe/London.";}
  return <FieldGroup title={<span className="inline-flex items-center gap-2"><Mail className="size-4 text-primary" />Email updates</span>}>
    <ToggleRow label="Reader subscriptions" hint="Readers can choose hourly additions, weekly digests, or both. Empty editions are skipped." checked={notifications.enabled} onChange={enabled => patch(draft => {draft.notifications.enabled = enabled;return draft;})} />
    {notifications.enabled && <div className="grid gap-3 sm:grid-cols-3">
      <Field label={<span className="inline-flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" />Digest day</span>}>
        {id => <Select value={String(weekly.weekday)} onValueChange={value => setWeekly({weekday: Number(value)})}><SelectTrigger id={id} className="w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select>}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><Clock3 className="size-4 text-muted-foreground" />Time</span>} error={!/^([01]\d|2[0-3]):[0-5]\d$/.test(weekly.time) ? "Choose a valid time." : null}>
        {(id, invalid) => <Input id={id} type="time" className="bg-background" value={weekly.time} aria-invalid={invalid || undefined} onChange={event => setWeekly({time: event.target.value})} />}
      </Field>
      <Field label={<span className="inline-flex items-center gap-2"><Globe2 className="size-4 text-muted-foreground" />Timezone</span>} error={timezoneError}>
        {(id, invalid) => <Input id={id} className="bg-background" value={weekly.timezone} placeholder="Europe/London" aria-invalid={invalid || undefined} onChange={event => setWeekly({timezone: event.target.value})} />}
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
