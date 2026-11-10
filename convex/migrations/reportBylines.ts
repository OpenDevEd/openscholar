import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { reportSettings } from "../reports/settings";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Gives every report the byline it was signed under, which its checks look for from now on (reports.byline). A report
// signed before reports kept theirs carries the series' wording as it stands when this runs, filled in as it was then,
// with "pending" for an ISSN the series doesn't have yet: the line its author was shown and put on the PDF. Run it
// before the series' byline changes. Safe to repeat.
export const signedBylines = migrations.define({
  table: "reports",
  migrateOne: async (ctx, report) => {
    if (report.byline !== undefined) return;
    const { series } = await reportSettings(ctx);
    return { byline: series.byline.replace("{doi}", `https://doi.org/${report.doi}`).replace("{issn}", series.issn || "pending").replace("{series}", series.name) };
  },
});

export const run = migrations.runner([internal.migrations.reportBylines.signedBylines]);
