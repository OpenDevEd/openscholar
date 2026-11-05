#!/usr/bin/env python3
# Usage: merge-communities.py [--rows-only] <prod-or-live-export.zip> <out.zip> <community name>...
#
# Brings communities from shared dev to prod. See README.md. Row IDs hold their table's number, and a community's ID also names
# its Coolify app and its database and search logins, so the IDs have to stay. Live's tables and these never share a number (it
# stops if they do), so the launch import gives each of these tables dev's number, even empty ones, and every row keeps its ID.
#   Launch: from live's export, makes the whole export for `convex import --replace-all`.
#   Later, with --rows-only: from prod's export, makes just the new rows for `convex import --append`.
# People are matched by email. Organizations need their production Clerk organization named in $R/clerk-organizations.json as
# {"<dev organization ID>": "<org_...>"}. CLERK_SECRET_KEY is production's: each member with a live account joins the production
# organization, and their membership row names that one.
import json, os, re, subprocess, sys, urllib.request, zipfile

args = sys.argv[1:]
rows_only = args[0] == "--rows-only"
live_path, merged_path, *names = args[1:] if rows_only else args
R = os.environ.get("R", os.path.expanduser("~/.os-rehearsal"))
ENV_FILE = os.path.expanduser("~/Documents/Github/openscholar/dev-self/.env.local")
DEV = dict(re.findall(r'^(CONVEX_SELF_HOSTED_\w+)="?([^"\n]*)"?$', open(ENV_FILE).read(), re.M))

# Everything a community keeps. Left out: OAuth clients (the publish makes new ones on production Clerk), hand-offs, digest
# jobs, leases, deletions and screening requests (short-lived work), and author publications (their profiles stay on dev).
BY_LIBRARY = ["evidenceLibraryApprovedQueries", "evidenceLibraryCollectionSources", "evidenceLibraryConfigDrafts", "evidenceLibraryConfigOperations", "evidenceLibraryConfigRevisions", "evidenceLibraryConfigSections", "evidenceLibraryCredentials", "evidenceLibraryDomains", "evidenceLibraryReaders", "evidenceLibraryRuntimeBindings", "evidenceLibrarySourceStatus", "evidenceLibraryZoteroGroups", "topicLocations", "topicDeliveryReceipts", "authorPublicationReceipts"]
BY_INDEX = {"topicLocations": "by_libraryId_and_itemKey", "topicDeliveryReceipts": "by_libraryId_and_idempotencyKey", "authorPublicationReceipts": "by_libraryId_and_itemKey"}


def data(table, keep=lambda row: True):
    """Every row of a dev table that `keep` takes, by the page: some tables are too large for `convex data`."""
    found, cursor = [], None
    while True:
        request = urllib.request.Request(f"{DEV['CONVEX_SELF_HOSTED_URL']}/api/query", method="POST", data=json.dumps({"path": "_system/frontend/paginatedTableDocuments:default", "args": {"table": table, "filters": None, "paginationOpts": {"numItems": 1000, "cursor": cursor}, "componentId": None}, "format": "json"}).encode(), headers={"Authorization": f"Convex {DEV['CONVEX_SELF_HOSTED_ADMIN_KEY']}", "Content-Type": "application/json", "User-Agent": "openscholar-launch/1.0"})
        with urllib.request.urlopen(request, timeout=120) as answer:
            page = json.loads(answer.read())
        if page.get("status") != "success":
            sys.exit(f"reading {table}: {json.dumps(page)[:300]}")
        found += [row for row in page["value"]["page"] if keep(row)]
        cursor = page["value"]["continueCursor"]
        if page["value"]["isDone"]:
            return found


def indexed(table, index, library):
    """A community's rows of a table too large to scan, through its index."""
    found, cursor = [], None
    while True:
        query = f"return await ctx.db.query({json.dumps(table)}).withIndex({json.dumps(index)}, (q) => q.eq('libraryId', {json.dumps(library)})).paginate({{ numItems: 1000, cursor: {json.dumps(cursor)} }})"
        done = subprocess.run(["npx", "convex", "run", "--inline-query", query], cwd=os.path.dirname(ENV_FILE), capture_output=True, text=True, env={k: v for k, v in os.environ.items() if not k.startswith("CONVEX_")})
        if done.returncode:
            sys.exit(f"reading {table}: {(done.stdout + done.stderr)[-400:]}")
        page = json.loads(done.stdout)
        found += page["page"]
        cursor = page["continueCursor"]
        if page["isDone"]:
            return found


def dev_tables():
    """Every table dev has, by name, with its number, including empty ones."""
    request = urllib.request.Request(f"{DEV['CONVEX_SELF_HOSTED_URL']}/api/query", method="POST", data=json.dumps({"path": "_system/frontend/getTableMapping", "args": {"componentId": None}, "format": "json"}).encode(), headers={"Authorization": f"Convex {DEV['CONVEX_SELF_HOSTED_ADMIN_KEY']}", "Content-Type": "application/json", "User-Agent": "openscholar-launch/1.0"})
    with urllib.request.urlopen(request, timeout=60) as answer:
        return {name: int(number) for number, name in json.loads(answer.read())["value"].items()}


live = zipfile.ZipFile(live_path)
live_tables = [json.loads(line) for line in live.read("_tables/documents.jsonl").decode().splitlines()]
live_rows = lambda table: [json.loads(line) for line in live.read(f"{table}/documents.jsonl").decode().splitlines()]
clerk_organizations = json.load(open(f"{R}/clerk-organizations.json"))

libraries = [row for row in data("evidenceLibraries") if row.get("name") in names]
missing = set(names) - {row["name"] for row in libraries}
if missing:
    sys.exit(f"no community named: {sorted(missing)}")
# A name isn't unique: a test community with the same one mustn't come along with its credentials.
if len(libraries) != len(set(names)):
    sys.exit(f"more than one community has one of these names: {sorted((row['name'], row['_id']) for row in libraries)}")
ids = {row["_id"] for row in libraries}
rows = {"evidenceLibraries": libraries}
for table in BY_LIBRARY:
    rows[table] = sum((indexed(table, BY_INDEX[table], library) for library in ids), []) if table in BY_INDEX else data(table, lambda row: row.get("libraryId") in ids)

# A source following a collection needs that collection on prod, which copy-collection.py puts there.
copied_path = f"{R}/copied-collections.json"
copied = json.load(open(copied_path)) if os.path.exists(copied_path) else {}
missing_collections = {row["collectionId"] for row in rows["evidenceLibraryCollectionSources"]} - set(copied)
if missing_collections:
    sys.exit(f"copy these collections to prod first (copy-collection.py): {sorted(missing_collections)}")
rows["evidenceLibraryCollectionSources"] = [dict(row, collectionId=copied[row["collectionId"]]) for row in rows["evidenceLibraryCollectionSources"]]

# The organizations that own them, with their workspaces and memberships.
workspaces = {row["_id"]: row for row in data("workspaces")}
owning = {row["workspaceId"]: workspaces[row["workspaceId"]] for row in libraries}
organization_ids = {row["organizationId"] for row in owning.values()}
absent = organization_ids - set(clerk_organizations)
if absent:
    sys.exit(f"name these organizations' production Clerk IDs in clerk-organizations.json: {sorted(absent)}")
rows["workspaces"] = list(owning.values())
rows["organizations"] = [dict(row, clerkOrganizationId=clerk_organizations[row["_id"]]) for row in data("organizations") if row["_id"] in organization_ids]

# People, by email. Someone with no live account is left out of what is theirs and reported.
dev_users = {row["_id"]: row for row in data("users")}
live_users = {row["email"].lower(): row for row in live_rows("users") if row.get("email") and row.get("state") != "deleted"}
user_ids, clerk_ids = {}, {}
for row in dev_users.values():
    match = live_users.get((row.get("email") or "").lower())
    if match:
        user_ids[row["_id"]] = match["_id"]
        clerk_ids[row["clerkId"]] = match["clerkId"]
memberships = [row for row in data("organizationMemberships") if row["organizationId"] in organization_ids]


def clerk(method, path, body=None):
    request = urllib.request.Request(f"https://api.clerk.com/v1{path}", method=method, data=json.dumps(body).encode() if body else None, headers={"Authorization": f"Bearer {os.environ['CLERK_SECRET_KEY']}", "Content-Type": "application/json", "User-Agent": "openscholar-launch/1.0"})
    with urllib.request.urlopen(request, timeout=30) as answer:
        return json.loads(answer.read())


for row in rows["organizations"]:
    row["slug"] = clerk("GET", f"/organizations/{row['clerkOrganizationId']}")["slug"]
rows["organizationMemberships"] = []
for row in memberships:
    clerk_user = clerk_ids.get(row.get("clerkUserId"))
    if not clerk_user or row.get("state") != "active":
        print("member left out:", row.get("clerkUserId"), row.get("state"), "no live account" if not clerk_user else "")
        continue
    organization = clerk_organizations[row["organizationId"]]
    found = clerk("GET", f"/organizations/{organization}/memberships?user_id={clerk_user}&limit=1")["data"]
    made = found[0] if found else clerk("POST", f"/organizations/{organization}/memberships", {"user_id": clerk_user, "role": row["role"]})
    rows["organizationMemberships"].append(dict(row, clerkMembershipId=made["id"]))
for row in libraries:
    if row["createdBy"] not in user_ids:
        sys.exit(f"{row['name']}: its owner has no live account")
rows["evidenceLibraryReaders"] = [row for row in rows["evidenceLibraryReaders"] if row["userId"] in user_ids]
# Who a community's editors are, and invitations still open. An item is the community's ID here, or `<ID>:<collection>` on a reader's collection.
of_community = lambda row: row["item"] in ids or row["item"].split(":")[0] in ids
rows["itemAccess"] = [row for row in data("itemAccess", of_community) if row["userId"] in user_ids]
rows["itemInvitations"] = [row for row in data("itemInvitations", of_community) if row["invitedBy"] in user_ids and row.get("acceptedBy", row["invitedBy"]) in user_ids]


def rewrite(value):
    if isinstance(value, dict):
        return {key: rewrite(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rewrite(item) for item in value]
    if isinstance(value, str):
        return user_ids.get(value) or clerk_ids.get(value) or value
    return value


rows = {table: [rewrite(row) for row in found] for table, found in rows.items()}

# Every table live doesn't have takes dev's number, so a later community can always come with its IDs.
taken = {row["id"]: row["name"] for row in live_tables}
dev_numbers = dev_tables()
new_tables = {table: number for table, number in dev_numbers.items() if table not in taken.values() and not table.startswith("_") and number not in taken}
clash = {table: taken[dev_numbers[table]] for table, found in rows.items() if found and table not in taken.values() and dev_numbers[table] in taken}
if clash:
    sys.exit(f"these tables' numbers are live's: {clash}")
if rows_only:
    wrong = {table: (taken.get(dev_numbers[table]), dev_numbers[table]) for table, found in rows.items() if found and taken.get(dev_numbers[table]) != table}
    if wrong:
        sys.exit(f"prod's numbers for these tables aren't dev's, so the launch import didn't reserve them: {wrong}")
if rows_only:
    # Only an organization the launch import brought has dev's IDs on prod. Any other would need its rows remapped onto the
    # ones production Clerk's webhook made, which this doesn't do.
    held_organizations = {json.loads(line)["_id"] for line in live.read("organizations/documents.jsonl").decode().splitlines()}
    if organization_ids - held_organizations:
        sys.exit(f"the launch import didn't bring these organizations: {sorted(organization_ids - held_organizations)}")
    # What prod already holds, such as an organization an earlier community brought, stays as it is.
    held = lambda table: {json.loads(line)["_id"] for line in live.read(f"{table}/documents.jsonl").decode().splitlines()} if f"{table}/documents.jsonl" in live.namelist() else set()
    rows = {table: [row for row in found if row["_id"] not in held(table)] for table, found in rows.items()}
with zipfile.ZipFile(merged_path, "w", zipfile.ZIP_DEFLATED) as merged:
    if not rows_only:
        for entry in live.namelist():
            if entry != "_tables/documents.jsonl":
                merged.writestr(entry, live.read(entry))
        all_tables = live_tables + [{"name": table, "id": number} for table, number in new_tables.items()]
        merged.writestr("_tables/documents.jsonl", "".join(json.dumps(row) + "\n" for row in all_tables))
    for table, found in rows.items():
        if found:
            merged.writestr(f"{table}/documents.jsonl", "".join(json.dumps(row) + "\n" for row in found))
for table, found in rows.items():
    if found:
        print(f"{table}: {len(found)}")
print("communities:", ", ".join(row["name"] for row in libraries))
