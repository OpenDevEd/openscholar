"use client";
import { CalendarDays, Clock3, Globe2, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "../section-card";
import { FieldGroup, ToggleRow } from "../fields";
import type { SectionProps } from "../section-shell";

export function NotificationsFields({draft, patch}: Pick<SectionProps, "draft" | "patch">) {
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
  </FieldGroup>;
}
