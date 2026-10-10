/** Most people one Evidence Library grants access to directly, so its team reads in one query (#357). */
export const MAX_LIBRARY_MEMBERS = 1_000;

/**
 * Most members one organization has, so its members read in one query: Clerk's member limit for
 * each plan (#652) stays under it. Past it, seat changes stop and say so.
 */
export const MAX_ORGANIZATION_MEMBERS = 1_000;

/** Most Evidence Libraries one organization can make, so its library list reads in one query. */
export const MAX_LIBRARIES_PER_WORKSPACE = 200;

/** Maximum evidence units loaded per paper.
 * Each extraction run produces evidence; 200 per paper is generous. */
export const MAX_EVIDENCE_UNITS_PER_PAPER = 200;

/** Served hosts one mutation writes or prunes; a Coolify listing takes as many batches as it needs. */
export const SERVED_HOSTS_BATCH = 500;

/** Most Evidence Libraries one person is granted directly; another grant is refused, so their grants read in one query. */
export const MAX_LIBRARY_GRANTS_PER_PERSON = 200;

/** Most invitations one library has waiting; another is refused until some are answered, cancelled or expire. */
export const MAX_PENDING_INVITATIONS_PER_LIBRARY = 500;

/** Most invitations waiting for one address across libraries; another is refused until some are answered or expire. */
export const MAX_PENDING_INVITATIONS_PER_EMAIL = 100;

/** Most author profile invitations waiting for one address; another is refused until some are answered or expire. */
export const MAX_PENDING_PROFILE_INVITATIONS_PER_EMAIL = 100;

/** Most people one author profile gives editing to, beside its owner; accepting another invitation past this is refused. */
export const MAX_PROFILE_MEMBERS = 100;

/** Most invitations one author profile has waiting; another is refused until some are answered, cancelled or expire. */
export const MAX_PENDING_INVITATIONS_PER_PROFILE = 100;

/** Most Zotero groups one library connects; another is refused until one is removed. */
export const MAX_ZOTERO_GROUPS_PER_LIBRARY = 100;

/** Most credentials one library stores: one per credential its configuration names. */
export const MAX_CREDENTIALS_PER_LIBRARY = 500;

/**
 * Of those, the places kept for the credentials a library's own setup writes (its database,
 * storage, application and service credentials: fixed keys, a handful). The credentials
 * people add are refused before they reach these, so setup can always finish.
 */
export const SETUP_CREDENTIALS_RESERVED = 20;

/** Most feature flags the table holds; the registry (lib/feature-flags/registry.ts) names a few dozen. */
export const MAX_FEATURE_FLAGS = 200;

/** Most author profiles one publication links to; a library's update naming more is refused. */
export const MAX_AUTHORS_PER_PUBLICATION = 1_000;

/**
 * Rows a write reads of something it keeps to one per person: a lock of one kind, a pending
 * Zotero sign-in, a Zotero connection, an active membership of one organization. Each write
 * removes the others it reads, so more than this can only be left by a burst, and the next
 * few writes clear it.
 */
export const SINGLE_ROW_CLEANUP = 10;

/**
 * Most accounts read for one email address when someone is invited. A deleted account keeps
 * its address, so this counts every sign-up and deletion of it; past it the invitation is refused.
 */
export const MAX_ACCOUNTS_PER_EMAIL = 100;

/** Most organizations one person is an active member of; past it their reads fail by name, not with a partial list. */
export const MAX_ORGANIZATIONS_PER_PERSON = 200;

/**
 * Most locations of one publication group a topic page reads looking for a public one. It
 * stops at the first, so only a group whose first copies are all private reads this far.
 */
export const MAX_LOCATIONS_READ_PER_GROUP = 100;

/**
 * Most queued or running operations of one kind a guard reads for a library. One setup and
 * one deployment run at a time, so a library past this is refused as busy, by name.
 */
export const MAX_ACTIVE_OPERATIONS_READ = 50;

/** People and organizations one assistant chat can be shared with (`assistant/sharing:grant`); reads of a chat's access rows take this many and its owner's. */
export const MAX_ASSISTANT_THREAD_GRANTS = 50;

/** Most invitations to items waiting for one address (`sharing/invitations:invite`); another is refused until some are answered or expire. */
export const MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL = 100;
