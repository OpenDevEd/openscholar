#!/usr/bin/env python3
# Usage: copy-collection.py <prod-export.zip> <dev collection ID>
#
# Copies a collection a community follows, with its papers, from shared dev to prod, a batch at a time through
# migrations/copyCollection. Its new ID goes in $R/copied-collections.json, where merge-communities.py looks it up.
import json, os, re, sys, urllib.request, zipfile

export_path, collection_id = sys.argv[1:]
R = os.environ.get("R", os.path.expanduser("~/.os-rehearsal"))
DEV = dict(re.findall(r'^(CONVEX_SELF_HOSTED_\w+)="?([^"\n]*)"?$', open(os.path.expanduser("~/Documents/Github/openscholar/dev-self/.env.local")).read(), re.M))
PROD = dict(re.findall(r'^(CONVEX_SELF_HOSTED_\w+)="?([^"\n]*)"?$', open(f"{R}/prod-convex.env").read(), re.M))
BATCH = 100


def call(target, kind, path, args):
    request = urllib.request.Request(f"{target['CONVEX_SELF_HOSTED_URL']}/api/{kind}", method="POST", data=json.dumps({"path": path, "args": args, "format": "json"}).encode(), headers={"Authorization": f"Convex {target['CONVEX_SELF_HOSTED_ADMIN_KEY']}", "Content-Type": "application/json", "User-Agent": "openscholar-launch/1.0"})
    with urllib.request.urlopen(request, timeout=180) as answer:
        reply = json.loads(answer.read())
    if reply.get("status") != "success":
        sys.exit(f"{path}: {json.dumps(reply)[:500]}")
    return reply["value"]


def rows(table, keep):
    found, cursor = [], None
    while True:
        page = call(DEV, "query", "_system/frontend/paginatedTableDocuments:default", {"table": table, "filters": None, "paginationOpts": {"numItems": 1000, "cursor": cursor}, "componentId": None})
        found += [row for row in page["page"] if keep(row)]
        cursor = page["continueCursor"]
        if page["isDone"]:
            return found


bare = lambda row: {key: value for key, value in row.items() if key not in ("_id", "_creationTime")}
export = zipfile.ZipFile(export_path)
copied_path = f"{R}/copied-collections.json"
copied = json.load(open(copied_path)) if os.path.exists(copied_path) else {}
if collection_id in copied:
    sys.exit(f"already copied as {copied[collection_id]}")

collection = rows("collections", lambda row: row["_id"] == collection_id)[0]
workspaces = {json.loads(line)["_id"] for line in export.read("workspaces/documents.jsonl").decode().splitlines()}
if collection["workspaceId"] not in workspaces:
    sys.exit(f"workspace {collection['workspaceId']} isn't on prod")
dev_users = rows("users", lambda row: True)
live_users = {row["email"].lower(): row["_id"] for row in map(json.loads, export.read("users/documents.jsonl").decode().splitlines()) if row.get("email") and row.get("state") != "deleted"}
user = {row["_id"]: live_users[row["email"].lower()] for row in dev_users if (row.get("email") or "").lower() in live_users}

links = rows("libraryItemCollections", lambda row: row["collectionId"] == collection_id)
wanted = {row["libraryItemId"] for row in links}
items = {row["_id"]: row for row in rows("libraryItems", lambda row: row["_id"] in wanted)}
print(f"{collection['name']}: {len(links)} papers")
if len(items) != len(links):
    sys.exit(f"{len(links)} places but {len(items)} papers")

owner = user[collection["createdBy"]]
new_id = call(PROD, "mutation", "migrations/copyCollection:collection", {"row": dict(bare(collection), createdBy=owner)})
copied[collection_id] = new_id
json.dump(copied, open(copied_path, "w"))
pairs = []
for link in links:
    item = bare(items[link["libraryItemId"]])
    item["createdBy"] = user.get(item.get("createdBy"), owner)
    place = {key: value for key, value in bare(link).items() if key not in ("collectionId", "libraryItemId")}
    pairs.append({"item": item, "link": place})
for at in range(0, len(pairs), BATCH):
    call(PROD, "mutation", "migrations/copyCollection:papers", {"collectionId": new_id, "workspaceId": collection["workspaceId"], "rows": pairs[at : at + BATCH]})
    print(f"  {min(at + BATCH, len(pairs))} of {len(pairs)}", flush=True)
print(f"copied as {new_id}")
