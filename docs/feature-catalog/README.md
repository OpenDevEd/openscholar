# OpenScholar and Evidence Community feature catalogue

Checked on 2 November 2026 against `dev.openscholar.ai` (OpenScholar `dev` at `18c990d3`) and the live communities on Evidence Community `main` at `f0f0be82`. `openscholar.ai` runs the older `main` branch and has none of the Evidence Community or extraction work, so a marketing page has to point at the `dev` release.

**How each row was checked**

| Label | Meaning |
|---|---|
| Ran | I used it for real today and read the result |
| Seen | The control or page is live and I opened it, but I didn't complete the action |
| Code | It is in the current code and settings, but I didn't try it today |

Screenshots are in [`shots/`](shots/). They are references for you, not marketing images: they hold test data such as "Feature Audit" and "Verify Agent".

## Check these before you write copy

1. **The assistant misreported a screening.** It told me "all three papers were marked as randomized trials, with none unclear", but the export shows Yes, Unclear, Unclear. It had set the pass mark to 0 of 1 points, so every paper counted as Included, and the page's top tally shows 3 included and 0 unclear. A screening built by hand doesn't depend on this, but "the assistant runs your screening" needs this fixed first.
2. **The README overclaims Zotero.** It says "sync directly to Zotero". OpenScholar reads Zotero (chats, chat-started jobs, Evidence Community sources) and I found no button that writes to it. Two-way sync exists only in the Evidence Community.
3. **Public author list.** `/authors` shows test profiles such as "Two97 author" to anyone. Clear them before linking to it.
4. **One unexplained miss.** The first Question search of the day didn't leave the page in 60 seconds. The next four worked in 5 to 17 seconds, so I couldn't reproduce it.

### Only partly general

**Evidence chains (`/evidence`)** runs only on AIED, from data built offline. A new community doesn't get it by turning on a switch.

## OpenScholar

### Search and discovery

| Feature | What it does | Check |
|---|---|---|
| Paper search | Searches OpenAlex, 329,118,430 works today by its API. The README's "250M+" is out of date | Ran |
| Keyword search | AND, OR and NOT, with each term coloured in the query and results | Ran |
| Question search | Turns a plain question into a Boolean search. "Does peer tutoring improve reading in primary school?" gave 203 results | Ran |
| OQL search | Queries written in OpenAlex's query language, with a reference | Code |
| Search scope | Title and abstract, title, abstract, full text or display name | Seen |
| Date filters | Year range or date range | Seen |
| Place filters | Institution location, and country focus by country or region | Seen |
| Quality filters | Open access, has an abstract, reviews, top 10% in field, journals and conferences only, not retracted | Seen |
| Detail filters | Publication type, language, study design, research areas, SDGs, journals, institutions, institution type, funders, authors, minimum citations | Seen |
| Citation graph | Finds what cites a paper, what it cites, and related works, from a card or by work ID | Seen |
| Sort and layout | Relevance, citations, date or title. Simple list, detailed list, 2 or 3 column grid | Seen |
| AI query help | Ask AI rewrites the query, and Make broader or Make specific adjusts it | Seen |
| Translation | Translates the query into 30 languages and can translate listed results | Seen |
| AI overview | Reads a whole search and writes a summary with charts and links to papers. Tabs: Overview, Year by year, Where it comes from, What to read first | Ran |
| Custom lenses | Write your own overview question, save it and share it with the workspace | Seen |
| Suggested searches | The home page suggests questions from your own searches | Seen |
| Paper cards | Authors, venue, citations, FWCI, percentile, topic hierarchy, SDGs with scores | Seen |
| Focus reader | Reads papers one at a time with keyboard keys for rating, saving and moving on, plus reading settings | Seen |
| Open access PDF | The PDF button opens the free copy in a new tab | Ran |
| Citations | APA 7, Harvard, Chicago 18, MLA 9, Vancouver and BibTeX, plus 2,851 more searchable styles | Ran |
| Search export | JSON or CSV, full or essential fields, for one paper or a whole result list | Seen |
| Share a search | A link opens it for workspace members and guests, and anyone else gets their own copy | Seen |
| Use without an account | Search, filters, history and bookmarks work signed out, stored in the browser | Ran |

Screenshots: [question results](shots/in-question-results.png), [overview](shots/in-overview.png), [results](shots/in-results.png), [focus reader](shots/in-focus2.png), [citations](shots/in-cite.png), [translation](shots/in-translate.png), [Adjust tab](shots/in-adjust.png), [suggestions](shots/va-home.png).

### Explore

| Feature | What it does | Check |
|---|---|---|
| Topics | Browse OpenAlex's 4,516 topics by domain, field and subfield, signed out too | Seen |
| Topic pages | Description, keywords, related topics, and papers from OpenAlex and your Evidence Communities | Seen |
| Author profiles | Public pages and a searchable list. Search papers from a profile | Seen |
| Create an author | Make and edit a profile, invite editors. | Seen |

Screenshots: [topics](shots/os-topics.png), [topic page](shots/in-topic.png), [authors](shots/va-authors.png).

### Library, history and bookmarks

| Feature | What it does | Check |
|---|---|---|
| Personal library | Save papers and rate them 0 to 5, then filter by date saved, year, rating or collection | Ran saving, Seen the rest |
| Collections | Group saved papers, rename, delete, and put one paper in several | Ran creating, Seen the rest |
| Library export | CSV or JSON | Seen |
| Search history | Every search with its result count, how the query changed, copy, delete, JSON download | Seen |
| Bookmarks | Short names that expand in a query, so `ml...` becomes a long term list. Live preview, JSON download | Seen |

Screenshots: [library](shots/in-library.png), [history](shots/in-history.png).

### Screening

| Feature | What it does | Check |
|---|---|---|
| Screening jobs | A model answers yes or no questions for every paper, and points decide who is in | Ran |
| Paper sources | A search (a range, a page or all of it), a collection, saved papers or an Evidence Community. From a chat, also a Zotero collection | Seen |
| Scoring | Points for Yes, No and Unclear on each question, a pass mark, and star ratings from the score | Seen |
| Write questions for me | Generates questions from the research question, or imports them from a search | Seen |
| Screen all | Starts from the search results page | Seen |
| Save results | Adds included papers to a collection, or removes excluded ones, here or in a community | Seen |
| Review and overrule | See the answer and confidence for each paper, change it, or put the model's answer back | Seen |
| Live progress | Queues papers as others finish, can cancel or run again | Ran |
| Export | CSV, JSON or Excel with Results and Summary sheets | Ran |

Screenshots: [new screening](shots/in-screening-new.png), [finished job](shots/in-screening-job.png).

### Data extraction

| Feature | What it does | Check |
|---|---|---|
| Extraction jobs | A model reads each paper's abstract and answers each question | Ran |
| Answer types | Text, yes or no, number, or list | Seen |
| Paper sources | A search, a collection, saved papers, a screening or an Evidence Community | Seen |
| Write questions for me | Drafts questions from the chosen papers | Seen |
| Confidence and evidence | Each answer has a confidence score and a citation you can open to check it | Ran |
| Views | Table, cards, or split view with the evidence beside it. Filters, chosen columns, search | Seen |
| Job control | Pause, resume, retry failures only, duplicate | Code |
| Export | CSV, JSON, or Excel with Results, Questions, Job, Evidence and Summary sheets. Can export only the selected rows | Ran |

A third paper with no abstract was left out and the job reported that.

Screenshots: [new job](shots/in-extraction-new.png), [table](shots/in-extraction-job.png), [split view](shots/in-extraction-split.png), [export](shots/in-extraction-export.png).

### Research assistant

| Feature | What it does | Check |
|---|---|---|
| Do the work from one message | From one message it searched, made a collection, saved 3 papers, then ran a screening and an extraction | Ran |
| Same actions as the app | 190 registered actions cover searches, community, jobs, workspaces, sharing and community settings | Code |
| Knows your page | Sees what you have open, and `@` points it at a search, collection or paper | Seen |
| Reads papers and files | Reads paper PDFs and attached images, PDFs and text files. Searches the web | Code |
| Zotero | Reads your groups, collections and items, and brings PDFs into the chat | Code |
| Community help | Reads and edits a community's draft settings, team, sources and publications | Code |
| Asks before it acts | Jobs and hard-to-undo changes wait for your approval. Bulk changes can be undone | Ran |
| Shared chats | Share a chat to read or to write, and see who else is in it | Seen |
| Model choice | Pick the model and reasoning effort for a chat | Seen |

Screenshot: [assistant](shots/in-assistant.png).

### Workspaces and collaboration

| Feature | What it does | Check |
|---|---|---|
| Workspaces | Everyone has a personal workspace, and each organization is another. A switcher moves between them | Seen |
| Organizations | Name, logo, colour, members, roles, invitations, leave or delete | Seen |
| Shared work | Members see all of the organization's collections, searches, screenings, extractions and chats | Seen |
| Run by | Filter a list by who started each item | Seen |
| Activity and presence | A history of changes on each item, and who has it open | Code |
| Guests | Invite outsiders to one item as Viewer or Editor. A Shared with me page lists it | Seen |
| Move | Move an item to another workspace, and see what goes with it first | Seen |
| Ratings in a collection | Each member's rating and the group's average | Code |

Screenshots: [workspace](shots/va-workspace.png), [members](shots/va-members.png).

### Creating and running an Evidence Community

| Feature | What it does | Check |
|---|---|---|
| New community | Pick a name, reserve an address, and create a draft. | Seen |
| One-step setup | Creates the database, storage and app, then builds it and puts it online. The page says about 2 minutes | Code |
| Brand | Name, logo, icons, colours, fonts, share image, funders, institutions | Seen |
| Content pages | Home page, navigation, footer, contact and legal text | Seen |
| Discovery | Search scopes and filters, tag filters, collections, citation formats, feature switches | Seen |
| Sources | Zotero groups, OpenAlex searches, OpenScholar collections, with import status and retry | Seen |
| AI | The owner's OpenRouter key, which models readers may use, and a default | Seen |
| Languages and analytics | 9 site languages, PostHog, Google Analytics, cookie consent | Seen |
| Publishing | Crossref DOIs and Zenodo archiving, with credentials checked before saving | Seen |
| Digests | Weekly or monthly schedule, pause, editor approval, attribution | Seen |
| Custom domain | Your own address with a DNS check. wealth-inequality.openscholar.ai and aievidencehub.org are live examples | Seen |
| Versions | Draft, activate, restore an earlier version, opt-in software updates | Seen |
| Team | Owner, Editor, Creator and Viewer roles | Seen |

Screenshots: [community list](shots/va-libs.png), [configuration](shots/va-config.png).

### Accounts and AI choice

| Feature | What it does | Check |
|---|---|---|
| AI presets | Cheap, Fast, Balanced or Intelligent, with a model for each task | Ran |
| Custom models | Choose the model and effort for each of 8 tasks | Seen |
| Bring your own key | Use your own provider key, stored in the browser, including while signed out | Seen |
| Zotero connection | Connect your Zotero account in Settings | Seen |
| Interface languages | 6: US and UK English, French, Chinese, Hindi, Japanese | Code |
| Site admin | Feature switches, model list, admins, and a link to users | Seen |

Screenshots: [AI settings](shots/in-settings-ai.png), [connections](shots/in-connections.png).

## Evidence Community

Each community is its own public site with its own records, database, search index and address. Owners turn most things on or off, so the table of live communities below shows what each one has.

### Home page

| Feature | What it does | Check |
|---|---|---|
| Community home page | Introduction, records by year, latest publications, how the community is curated with live counts, the team, and ways to get involved | Seen |
| Suggest or join | Readers can suggest a publication or offer to edit | Seen |

Screenshot: [home page](shots/wi-home-live.png).

### Search and browse

| Feature | What it does | Check |
|---|---|---|
| Keyword search | Scopes include title and abstract, authors, all metadata, full text and everywhere. Nine sort orders | Ran |
| Meaning-based search | Records are indexed by meaning when AI answers are on | Code |
| Sidebar filters | Topic areas or collections, years as a bar chart, record types, PDFs, top authors, most cited, with counts | Seen |
| Study types | AI reads each record as a meta-analysis, randomised trial and so on, marks it uncertain under 60%, and an editor can correct it | Seen |
| More filters | Institutions, country focus, author countries, topics, tag filters | Seen |
| And/Or for collections | Choose whether a record must be in any or all of the ticked collections | Seen |
| List or grid | With PDF covers on cards and abstracts on or off | Seen |

Screenshots: [community](shots/wi-lib-live.png), [collections](shots/us-lib.png).

### Records

| Feature | What it does | Check |
|---|---|---|
| Record page | Abstract, authors, topics, collections, files, and links to the original | Seen |
| Open access label | Labels open records, optionally closed ones too | Seen |
| PDF covers | A record's first page shows on its card, and clicking it opens the PDF | Seen |
| Citations and references | Shows how many are in the community out of the total, and opens the rest in OpenScholar | Seen |
| Cite | The same styles as OpenScholar, searchable | Seen |
| Copy buttons | Link, abstract, DOI and other fields | Seen |
| Share preview | A record's PDF cover or title card shows when the link is shared | Code |
| Summarize and Explain | AI on a single record, or a chat about it | Seen |

Screenshot: [record](shots/wi-record.png).

### Maps

| Feature | What it does | Check |
|---|---|---|
| Globe by country focus | Colours countries by the ones the papers study, as a total or per million people | Seen |
| Globe by author country | The same, by where the authors work | Seen |
| Globe by institution | Places 9,988 institutions in 179 countries on Wealth Inequality, ranked, with search | Ran |
| Evidence chains | Maps who cites whom across AIED's 131,794 papers and flags reviews with broken evidence. AIED only | Seen |

Screenshots: [country map](shots/wi-map-mode.png), [institutions](shots/wi-map-institutions.png), [evidence chains](shots/aied-evidence.png).

### Ask AI and smart screening

| Feature | What it does | Check |
|---|---|---|
| Ask AI across the community | Searches and reads records, then answers with links to the record and PDF page | Ran |
| Honest about gaps | In the test it said one PDF wouldn't download, so it reported only the abstract | Ran |
| Ask about results | Asks about your current search results, and attaches records to a chat | Seen |
| Sources panel | Lists what the AI read beside the answer | Ran |
| Export a chat | Copy or export as Markdown, HTML, CSV or text | Seen |
| Model choice | Readers choose from the models the owner allows | Seen |
| Smart Screening | Add your own fields and have the AI fill them in for the records a chat cites | Seen |
| Continue in OpenScholar | Sends the results, search or collection on, where Screen and Extract are offered | Ran |

Screenshots: [Ask AI](shots/qa-ask-answer2.png), [Smart Screening](shots/qa-ss-settings.png), [hand-off](shots/qa-handoff2.png).

### Digests

| Feature | What it does | Check |
|---|---|---|
| Digest page | AI-written summaries by period, with reviews first and the next edition date | Seen |
| Email subscription | Readers subscribe and get each edition by email | Seen |
| Editorial control | Optional editor approval, and a note saying who checked it or that AI wrote it | Code |
| Schedule | Weekly or monthly, chosen day and time zone, pause, send now | Code |

Screenshot: [digests](shots/wi-digests-live.png).

### Reader accounts

| Feature | What it does | Check |
|---|---|---|
| Sign in with OpenScholar | One account across communities | Ran |
| Bookmarks and collections | Save records into private or public collections | Seen |
| Reader profile | A shareable page with their bookmarks and collections | Seen |
| Share a collection | Invite people to view or add, and see who it's shared with | Code |

Screenshot: [profile](shots/qa-profile.png).

### Exports and open standards

| Feature | What it does | Check |
|---|---|---|
| Download records | RIS, BibTeX, formatted HTML or plain text citations, for current results or the whole community, up to 20,000 records | Seen |
| Atom feed | A feed of new records | Ran |
| Sitemap and robots | For search engines | Ran |
| Reference managers | unAPI with MODS, for tools such as Zotero's connector | Code |

Screenshot: [download](shots/wi-export.png).

### Admin

| Feature | What it does | Check |
|---|---|---|
| Record table | Search, filter by kind, state, source or collection, choose columns | Seen |
| Create records | Write a record by hand as a draft | Seen |
| Import PDFs | Up to 100 PDFs at 50 MB each. AI reads each one and fills in the record, with your own checks and instructions | Seen |
| Import by DOI | Paste DOIs to make records | Seen |
| Import files | `.ris`, `.bib`, `.bibtex`, `.json`, `.xml`, `.nbib`, `.mods`, `.txt` | Seen |
| Draft and review | Creators submit, and Editors or Owners publish or send back. Nothing reaches readers before that | Seen |
| Draft preview | See the public page beside the editor | Code |
| Bulk actions | Add, remove or delete selected records | Seen |
| Collections | Create, move and restore | Seen |
| Digest editing | Edit, review and publish each digest | Seen |
| Status panels | Search index state, source import state and record issues | Seen |
| Conflict handling | Compare and resolve when a source and an editor changed the same record | Code |
| DOIs | Register through Crossref, or archive files and get a DOI through Zenodo | Code |

Screenshots: [admin](shots/qa-admin-record.png), [import](shots/qa-admin-import.png).

### Where records come from

| Source | What it does | Check |
|---|---|---|
| Written in the community | Native records with no outside source | Seen |
| OpenAlex search | Imports a saved search and fetches only what changed. Wealth Inequality updates nightly | Seen |
| Zotero group | Two-way sync: imports records and writes editors' changes back. PDFs published by tag or all | Code |
| OpenScholar collection | Fills the community from a collection, used on AIED | Code |
| Full text | Downloads PDFs where the licence allows and keeps records searchable when a download fails | Seen |
| Screening a source | AI screens incoming records against a subject, with a trial on 200 records first | Code |

### Site languages and policy pages

| Feature | What it does | Check |
|---|---|---|
| Languages | 9: UK and US English, French, German, Portuguese, Arabic (right to left), Hindi, Chinese, Swahili | Code |
| Theme | Light and dark, with a switch if the owner allows it | Seen |
| Contact and takedown | Forms that email the owner's chosen address | Seen |
| Legal pages | Privacy and cookie policy, plus terms if the owner writes them | Seen |
| Consent and analytics | Cookie settings, PostHog or Google Analytics | Seen |

### Live communities

From each community's active settings today.

| Community | Records seen | Home page | Reader accounts | Digests | Languages |
|---|---|---|---|---|---|
| [AIED](https://aied.openscholar.ai) | 131,794 | Yes | Yes | Paused | 1 |
| [Wealth Inequality](https://wealth-inequality.openscholar.ai) | 52,447 | Yes | Yes | On | 1 |
| [USAID](https://usaid.openscholar.ai) | 46,057 in its collections | Yes | Yes | On, with approval | 9 |
| [AI in Measurement and Education](https://aievidencehub.org) | Not counted | No | No | Off | 1 |
| TVET | Not opened | Yes | Yes | Paused | 1 |
| Climate Change Adaptation and Resilience | Not opened | Yes | Not set | Paused | 1 |

All six have AI answers, country focus and author filter on. Downloads and the Atom feed are on for all six as well.

## What I didn't test today

- Connecting a Zotero account, because the test accounts have no Zotero login.
- Crossref and Zenodo, which are off on the test community.
- Sending a digest email, and subscribing.
- Anything needing two people: guests and presence.
- Creating a new community or adding a custom domain.
- Phones, Firefox and Safari. All of this ran in desktop Chromium.

AIED, TVET and ECCAR are not used as test targets, so I only opened AIED's `/evidence` page signed out. Ask AI ran once on the Sources QA community.
