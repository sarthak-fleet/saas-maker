#!/usr/bin/env python3
"""Source of truth for SaaS Maker's scored idea catalog.

Run from apps/showcase: python3 ideas/build.py

Scoring:
- F/M/T/C each /10
- C = competition pressure (1 open field, 10 brutal)
- M_eff = max(M - max(C-3, 0), 0)
- Adj  = F + M_eff + T
- Active iff max(F, M_eff, T) >= 8
"""

import json, re, csv
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Hand-curated AI ideas (fleshed-out detail + scores incl. competition)
# ---------------------------------------------------------------------------

AI_IDEAS = [
    # (F, M, T, C, title, body)
    (7, 9, 10, 10, "Trustworthy automation infra (theme)",
     "Reliable agent execution in messy real-world systems: permissions, retries, idempotency, rollback, audits. Eval harnesses, provenance, real guardrails. **Comp:** LangSmith, LangFuse (acq'd by ClickHouse Jan 2026), Braintrust, Helicone, Galileo, Arize ($70M Series C Feb 2025) — extremely well-funded and consolidating. **Wedge:** only viable as a single vertical (e.g. revenue ops, back-office finance) where guardrails are mandatory; horizontal play is dead."),
    (5, 9, 8, 10, "Interoperability / data plumbing (theme)",
     "Moving data across SaaS tools, warehouses, CRMs; schema mapping, identity resolution, lineage, business-logic glue. **Comp:** Fivetran (acquired Census May 2025), Airbyte, Hightouch, Stitch, Segment, Workato — consolidating. **Wedge:** AI-native config for solo PMs is a thin wedge against acquirers with $B war chests. Skip unless you have a unique data source."),
    (6, 5, 7, 8, "Personal knowledge assistant",
     "Personal RAG that flags whether a new input is genuinely new vs. already known to you. Primitive that powers \"is this novel?\" elsewhere. **Comp:** Mem, Notion AI, Reflect, Obsidian + Smart Connections, Glasp. **Wedge:** API-first; let other apps consume the \"novelty\" signal — this is the only defensible angle."),
    (7, 5, 7, 7, "AI social media with named personas",
     "Social network populated by AI influencer personas that post, comment, like, and cross-platform. Users can hire them. **Comp:** Character.ai (~$32M ARR, exploring sale), Hedra ($32M Series A May 2025), Botify. **Wedge:** social/feed dynamics (algorithmic timeline, persona-vs-persona arcs) — distribution will be the actual challenge."),
    (6, 4, 6, 5, "AI cacher",
     "Cached-Q&A SaaS for knowledge bases that don't change often (regulations, medical, education). Per-topic TTL, vector-stored questions + answers, link related Qs. **Comp:** GPTCache, langfuse cache — infra primitives. **Wedge:** the *product* layer (browseable cached answer pages + SEO). Honest take: M is capped because cache-as-product fights commodity LLM pricing."),
    (5, 4, 5, 8, "Build a vector DB from a website",
     "Point at a sitemap, get a queryable embedding store + embed snippet. **Comp:** SiteGPT (active, funded), Mendable (YC), custom GPTs, Chatbase, hundreds of clones. **Wedge:** white-label / API-first — but pricing race-to-zero in this category."),
    (6, 4, 6, 10, "Chat with content (books / podcasts / hoarded stuff)",
     "Chat-with-PDF / podcast / starred-repos. **Comp:** ChatPDF, Glasp, MyMind, Recall, NotebookLM (free, owned by Google), hundreds of variants. **Wedge:** none — NotebookLM alone makes this category dead unless you own a unique corpus."),
    (5, 3, 6, 4, "Find similar git commits",
     "Search commit history semantically. Find prior changes that touched related code, similar bug fixes, etc. **Comp:** Sourcegraph (broad), Greptile (has codebase indexing), nothing dedicated. **Wedge:** zero-config dev tool, $5/mo per dev — but Greptile/CodeRabbit likely add this as a feature."),
    (6, 4, 6, 8, "Search across browser history",
     "Semantic search over your tabs, auth'd pages handled gracefully (store metadata not content). **Comp:** Rewind (now Limitless 2.0, well-funded), Arc (acquired/wound down), History.app, raycast-history, Dia browser. **Wedge:** privacy-first local-only mode is the only credible angle."),
    (5, 3, 5, 6, "Multi-LLM Q&A with voting",
     "10 LLMs answer common questions; users vote best answer. **Comp:** Chatbot Arena (research authority), Poe, You.com Smart, OpenRouter ($500M val). **Wedge:** SEO play (cached canonical answers for long-tail queries) — but Google AI Overviews + Perplexity own this surface now."),
    (5, 4, 6, 8, "Research paper recommender",
     "Embeddings per paper, graph-based prereq view, cited-by hierarchy. **Comp:** Elicit, Semantic Scholar, Scite, Undermind, Consensus — all rely on the same underlying indexes and compete on UX. **Wedge:** none obvious unless vertical-specific (e.g. medical, legal)."),
    (6, 4, 5, 6, "Subreddit / community digester",
     "Every ~8h, distill trending posts of a subreddit into a Slack/email digest. Cache results, SEO pages per subreddit. **Comp:** various Substack newsletters, Pushshift-derived tools, custom GPTs. **Wedge:** broad coverage + custom prompts per user; Reddit API pricing makes scale painful."),
    (4, 3, 5, 7, "Celebrity / fictional-character SEO site builder",
     "Auto-generated sites about celebrities or franchise characters; community-edited; appearance tracking. **Comp:** Fandom, Wikipedia, IMDb. **Wedge:** AI-generated long-tail — Google's helpful-content updates actively penalize this pattern. Risky."),
    (4, 4, 5, 5, "AI Ayurveda / wellness store",
     "Problem → herb/mineral lookup with disclaimers, integrated store. JAMStack with auto-blog-from-query. **Comp:** Practo, Cure.fit, various Ayurveda sites, Amazon herbal listings. **Wedge:** product-first not content-first; commerce angle. Regulatory risk in medical claims."),
    (6, 3, 5, 6, "Memenza — AI meme generator",
     "Best-template-finder from user text; tiered uploaders; AI personas riff on news headlines. **Comp:** Imgflip + AI, Supermeme.ai, ChatGPT + image gen. **Wedge:** persona/feed angle — but consumer meme tools have ~0 willingness to pay."),
    (4, 7, 6, 7, "B3 — Recruiter / candidate intelligence",
     "Enrich candidates from public signals (GitHub, talks, posts); score fit vs. JD; surface passives. **Comp:** Gem ($AI-first all-in-one), Findem (acquired Getro), Loxo, LinkedIn Recruiter, Eightfold (talent-intelligence), Juicebox. **Wedge:** target solo recruiters and 1–5-person agencies at $50–200/mo — viable if you find the SMB channel; incumbents won't price down."),
    (6, 7, 7, 8, "A1 — Synthetic user QA tester",
     "AI agent walks through user flows from a natural-language spec; reports regressions. **Comp:** QA Wolf (managed service), Mabl, Reflect, Octomind (raised $4.8M), Momentic, Bug0, plus Devin/Cursor-as-tester. **Wedge:** persona-based synthetic users that retain memory across sessions — credible technical wedge, but space is filling fast."),
    (4, 5, 6, 7, "B2 — AI postmortem / RCA generator",
     "Ingest incident timeline (logs, alerts, Slack, PRs); draft postmortem. **Comp:** Rootly ($12M Series A) Copilot, incident.io Scribe, FireHydrant AI-Drafted Retrospectives, Datadog Bits AI, PagerDuty Scribe, free River tool, ServiceNow Now Assist SRE. **Wedge:** standalone/BYO-IM is now a saturated wedge — every incident vendor ships this for free."),
    (5, 6, 7, 9, "B1 — AI log / incident copilot",
     "NL queries on logs, anomaly explanations, cross-service correlation. **Comp:** Datadog Bits AI (NL log queries shipped), New Relic AI, Honeycomb Query Assistant, Splunk AI, Logz.io AI, Grafana. **Wedge:** vendor-agnostic ingest is interesting in theory — but log volume costs make standalone economics brutal."),
    (4, 5, 6, 6, "A4 — Negotiation / sales roleplay partner",
     "Voice AI roleplays prospects for SDR/AE training. **Comp:** Hyperbound ($15M Series A Sept 2025, $18.3M total, $1M+/mo new ARR), Second Nature, Trellus. **Wedge:** vertical-specific scenarios + import customer transcripts as training data — Hyperbound is pulling away from this segment."),
    (4, 5, 5, 9, "B5 — Customer interview digest",
     "Cluster themes across recorded calls (Gong/Otter/Fireflies); extract quotes per theme. **Comp:** Gong, Chorus, tl;dv, Fathom, Granola ($125M Series C at $1.5B val Mar 2026), Otter, plus Dovetail/Marvin on the PM side. **Wedge:** BYO-recordings PM-tool-first is a real angle but Granola is moving into 'meeting context for the enterprise' fast."),
    (4, 4, 6, 8, "B6 — AI knowledge ops",
     "Internal-doc search with staleness flagging and ownership inference. **Comp:** Glean (no public pricing, 100-seat min, $50K-$480K/yr), Microsoft Copilot, Notion AI, Atlassian Rovo, eesel, GoSearch. **Wedge:** small teams (10–50) at $5/seat is a genuine gap Glean explicitly ignores — but switching cost is low and incumbents will follow if you prove it works."),
    (7, 5, 7, 8, "C2 — Screen / browser copilot",
     "Always-on copilot that watches your screen and proactively offers context. **Comp:** Cluely ($20.3M raised, $7M ARR, a16z-backed, going viral), OpenInterpreter, Self-Operating Computer, Highlight, Rewind/Limitless 2.0, Granola moving into context. **Wedge:** privacy/local-LLM mode is plausible but Cluely sucked the oxygen out of this in 2025."),
    (8, 4, 9, 5, "B4 — AI step-through debugger",
     "AI explains \"why is this variable that value?\" by tracing prior steps. Production traces via log replay. **Comp:** IDE debuggers, Cursor, Sentry session replay, Rookout (acquired by Dynatrace). **Wedge:** post-mortem replay debugging on production traces — real tech, genuinely novel. F/T are the draw."),
    (4, 7, 7, 9, "A3 — Deep-dive investment analyst",
     "Ingest 10-Ks, transcripts, news, expert calls; produce structured company deep-dives. **Comp:** AlphaSense ($4B val, acquired Tegus for $930M), Hebbia ($130M Series B), Daloopa ($13M strategic 2025), BamSEC, Brightwave. **Wedge:** solo investor / family office tier at $500/mo is plausible but data licensing (transcripts, expert calls) is the actual moat — and incumbents have it."),
    (4, 8, 8, 5, "A2 — Legacy code resurrection",
     "AI-assisted COBOL/old-Java/Perl-monolith → modern stack migration with test harness generation. **Comp:** Anthropic Claude Code direct push (SSA $1B project, IBM watsonx Code Assistant for Z), specialized consultancies, Azure Legacy-Modernization-Agents OSS. **Wedge:** Anthropic/IBM are eating the platform; deliverable wedge is still consulting + tooling — solo can land 1-2 6-figure contracts but not productize easily."),
    (6, 4, 7, 8, "C1 — LLM experiment / routing hub",
     "Best-model-per-call routing, A/B, fallback chains, cost tracking. **Comp:** OpenRouter ($500M val, $50M ARR, 2M+ users), LiteLLM (470k downloads, Netflix/Lemonade prod), Portkey (400B+ tokens/day, 200+ enterprises), Helicone, Braintrust. **Wedge:** thin — OpenRouter owns the marketplace, LiteLLM owns OSS proxy."),
    (4, 3, 5, 8, "B7 — LLM benchmarks & cost optimizer",
     "Continuous prompt eval across models + cost forecasting + opt recommendations. **Comp:** Helicone, PromptLayer, LangSmith, Braintrust, Portkey (cost-aware routing built-in). **Wedge:** focus on the *recommendation* — but if Portkey/OpenRouter route automatically by cost, recommendations become a feature."),
    (6, 3, 6, 4, "C3 — Builder brain",
     "Personal AI that remembers what you've built, tried, abandoned; surfaces patterns. **Comp:** none directly; ChatGPT memory is the lazy substitute. **Wedge:** indie hackers / solo founders at $10/mo; small market but real."),
    (5, 5, 5, 8, "Idea #1 — Competitor listener",
     "Enter your company URL → monthly report on industry chatter; scan Twitter/LinkedIn for employee movement and hiring. **Comp:** Crayon ($12.5K-$47K/yr), Klue ($16K-$45K/yr), Kompyte ($20K avg ARR, acq'd by Semrush), Apollo, Clay, newer agent-based scrapers. **Wedge:** solo-founder pricing is feasible but report quality is the bar; LinkedIn TOS makes scraping fragile."),
    (3, 7, 2, 5, "Idea #2 — Society of VERY Interesting People",
     "Application-only paid community (100–200 members at $2.5–5K/yr). 3 interviews per member per year, custom questions. **Comp:** Trends.co, Hampton, Pavilion, Sidebar, Chief, YPO. **Wedge:** the *content* (interview corpus) as a moat — execution-heavy, not a software business."),
    (5, 4, 4, 9, "Idea #3 — DateMyFriends",
     "Dating app where your friends build/promote your profile and approve introductions. **Comp:** Hinge, Bumble, Wingman (the friend-managed app, active), Coffee Meets Bagel, Curtsy. **Wedge:** consumer dating is brutal at any vertical; only the largest incumbents survive — Match Group network effects dominate."),
    (4, 6, 5, 8, "Idea #4 — Granola for Salespeople",
     "Call recording + automated personalized sales-style follow-ups. **Comp:** Granola ($1.5B val, displacing Fathom/Otter), Fathom, Otter, Gong, Apollo's call recorder, Salesloft Drift. **Wedge:** sales-rep-specific tone — Granola already moving toward enterprise context layer; window is closing."),
    (3, 5, 2, 3, "Idea #5 — Undercover customer as a service",
     "Real humans walk through your sales funnel and report what's broken. Service business. **Comp:** UserTesting (script-based), TryMyUI, FullStory recordings. **Wedge:** humans + structured report — but service margins are low and AI agents (browser-use, Magnitude) will eat this in 2-3 yrs."),
    (5, 4, 4, 5, "Idea #6 — Memories for your email",
     "\"On this day\" feature for email; nostalgia + nudge to reconnect with old contacts. **Comp:** Superhuman has some of this, Reclaim.ai, Shortwave. **Wedge:** standalone Gmail extension — small market, low willingness to pay."),
    (3, 4, 3, 4, "Idea #7 — 360 life audit",
     "Service auditing your wardrobe, diet, skincare, hobbies, spending; gives well-researched suggestions. Service business. **Comp:** various luxury concierge services, Stitch Fix, AI personal stylists. **Wedge:** AI-automated tier + premium human tier — service-business economics."),
    (3, 4, 2, 3, "Idea #8 — Productivity retreats",
     "Anti-yoga retreat. Sign up to be extremely productive for 30/90 days. **Comp:** Builders & Backers, Edyn, On Deck (sort of), Hampton. **Wedge:** focus + accountability not networking — operational nightmare for a solo builder."),
    (4, 2, 5, 4, "C4 — Small incident / log explainer",
     "Single-feature standalone — likely better as part of B1, not its own business."),
]

# ---------------------------------------------------------------------------
# README items: keep existing prose, add C scores by lookup
# Key = first ~50 chars of the title (stable enough to match)
# ---------------------------------------------------------------------------

# Hand-curated C (and F/M/T) per README idea
# Format: (F, M, T, C, full description). Source = "README".
README_IDEAS = [
    (9, 6, 10, 7, "An app that animates manga and comics. Ensure voice for a particular character remains the same, identify dialogue owners, assign a consistent voice/tone; fill scene gaps, add BGM, optionally extend novels by generating character designs. Training data: manga → anime conversions. **Comp:** Runway, Pika, Wonder Dynamics, AnimateAI, Komiko, Revid.ai. **Wedge:** manga-specific (voice consistency across many chapters + dialogue ownership detection). Real category but generic anime-gen is crowded."),
    (8, 8, 8, 10, "AI analytics company: auto-generates user reports from instrumentation; flow diagrams; identifies pain points and self-labels gaps. Browser-extension mode for users to see how they interact. Can predict the user's next move. State-machine view of user lifecycle. **Comp:** PostHog (raised $75M Series E Sep 2025 at $1.4B, AI product assistant + session summaries shipped), Heap, FullStory, June, Mixpanel, Amplitude. **Wedge:** brutal market; only a sharp vertical (e.g. e-commerce conversion reports) has a shot. M_eff ≈ 1."),
    (8, 6, 9, 7, "DB → sheet/notion app with git-style data merge, virtual grid for high-capacity, AI copilot, shareable subData. **Comp:** Airtable, Outerbase, Rowy, Glide, Baserow, NocoDB, Dolt (the actual git-for-data). **Wedge:** the git-style merge angle exists (Dolt) but a Notion-style UX on top is open. Hard tech."),
    (8, 5, 9, 6, "Bizarre idea: fluid apps — apps that let users prompt and modify the app to their liking at runtime. **Comp:** Bolt.new ($40M ARR in 6mo), v0, Lovable ($200M at $1.8B, $20M ARR in 2mo), Replit Agent — all build-time. Runtime malleability is genuinely greenfield. **Wedge:** runtime prompt-driven UI mutation, not one-shot generation."),
    (8, 5, 9, 5, "Time-series geographical heatmap from many sources (Swiggy-style demand). Approximate future demand from history; IP-as-input. Timeseries DB or CH. Kalman/Viterbi for smoothing. **Comp:** Mapbox, Kepler.gl, Carto, Datawrapper, Foursquare Studio. **Wedge:** real-time multi-source forecasting (not just visualization); B2B sales motion hard for solo."),
    (7, 7, 8, 8, "Pluggable recommendation system anyone can plug in: custom fields, custom interactions, weightages. Vector-search backbone, beta mode, test env. **Comp:** Algolia Recommend (free tier 10K req/mo), Recombee ($99/mo, free tier 100K), AWS Personalize, Shaped.ai. **Wedge:** even \"indie\" tier is taken by Recombee's free plan — hard to differentiate on price alone."),
    (6, 7, 8, 9, "Scalable n8n alternative — automation builder that doesn't fall over above N workflows. **Comp:** n8n ($180M Series C at $2.5B, NVIDIA-backed), Zapier, Make, Pipedream, Workato, Gumloop. **Wedge:** scaling-perf alone is thin — n8n's the open-source king, fighting them on their turf is brutal. Vertical RevOps angle only."),
    (8, 5, 7, 7, "A SM with personality bots that interact with all posts and each other. Users create agents with their own API keys (for a price). Agents discuss and reach consensus. Could power StoryTunes-style collab. **Comp:** Character.ai, Hedra, Moltbook (AI-only social network launched 2025/26 with 37K agents in a week). **Wedge:** multi-agent dynamics with consensus + human-readable; Moltbook proved demand for the format."),
    (8, 4, 8, 6, "Build a minimalist graph library for fun. Canvas, WebGL, SVG. Useful for: knowledge graphs, family-tree managers, agent decision diagrams, learning-tool annotations (click → make an anki card). **Comp:** D3, Sigma.js, react-flow (dominant for AI agent UIs), Cytoscape. **Wedge:** ergonomic API + opinionated layouts for specific use cases — but OSS-economy means M near zero."),
    (8, 3, 7, 8, "Tree Visualizer — visualise tree algorithms; let users build trees and write algo there. Extend with an IDE for collaborative leetcode (test + submit for all). **Comp:** LeetCode, Coderpad, HackerRank, VisuAlgo, AlgoExpert. **Wedge:** real-time collab on the algorithm canvas; small TAM though, hard to monetise."),
    (7, 3, 9, 4, "A website that tells you the time complexity of code you paste. Tests for edge cases when given expected input size. Class to detect infinite loops, misc errors. Reports execution time on various inputs. **Comp:** Big-O calculators (academic), Codility-style runners, ChatGPT itself does this. **Wedge:** rigorous empirical testing not just static analysis."),
    (7, 4, 7, 4, "Let old machines be used as a server. Next step Dukaan-style hosting. Full CI/CD, metrics, log management. Auto scale/descale. **Comp:** Hetzner/OVH self-host, Coolify, Caprover, Dokploy. **Wedge:** repurposing-old-hardware angle is novel for indie/hobby; weak monetization."),
    (7, 4, 6, 8, "The family tree app — https://github.com/sarthakagrawal927/Tree. **Comp:** Ancestry, MyHeritage (21B records, 81M trees), FamilySearch (free), 23andMe, Geni. Market is locked by DNA + records moats; M_eff is brutal. (full spec in `docs/product/specs/family-tree.md`)"),
    (8, 4, 7, 5, "Storytunes. Multi-author collab story writing with line-by-line voting; can include AI contributors. Each on-site event = a story; auto-summarised. Spec: `docs/product/specs/storytunes.md`. **Comp:** Storium, PlotVote, WriteJam, Storyfall, Mycelore, NovelAI (single-player). **Wedge:** AI persona contributors voted alongside humans — fun, niche, hard to scale revenue."),
    (5, 6, 6, 10, "Meeting helper a la shadow.do / cluely.com. **Comp:** Granola ($125M Series C at $1.5B Mar 2026, 250% q/q growth), Fathom (free + unlimited), Otter, Cluely ($20M raised), Tactiq, tl;dv. **Wedge:** specific vertical only — interview/therapy/legal — generic note-taking is fully cooked. M_eff ≈ 0 generically."),
    (5, 5, 7, 7, "CCTV app customisable for special queries (\"how long did the doctor sit?\", \"is the bin in position?\"). **Comp:** Verkada (shipped AI-powered natural-language search Oct 2025: \"person driving forklift\" queries), Camio, Lumana, custom CV. **Wedge:** Verkada owns this for hardware buyers; software-only/BYO-camera angle is the only opening."),
    (8, 3, 8, 5, "Open world game with AI characters. NPCs with persistent memory, emergent storylines. **Comp:** Inworld AI, Convai, Altera, Skyrim modding scene with LLM mods. **Wedge:** indie title scale; tech is fun but monetisation is brutal for solo."),
    (7, 3, 8, 5, "An app that lets you build walkable 3D worlds; choose to design each building. **Comp:** Roblox Studio, Decentraland, Spatial, Horizon Worlds, Promethean AI. **Wedge:** AI-assisted building — but Roblox/Spatial own the install base."),
    (6, 5, 7, 9, "Lightweight observability + logs framework you can attach to all your products with one click. **Comp:** Datadog ($1K+ integrations), Sentry, Axiom (serverless logs darling), Highlight, BetterStack, SigNoz, Baselime. **Wedge:** indie-priced + dead-simple — but Axiom/BetterStack already own this space at the cheap end. M_eff ≈ 0."),
    (6, 5, 7, 7, "Analyses GitHub repository history; explains how the codebase works and behaves. Determines importance by change-frequency; explains each commit, effort, contribution patterns. **Comp:** Sourcegraph, Greptile ($25M Series A Sep 2025, Benchmark-led), CodeRabbit ($60M Series B), Graphite ($52M). **Wedge:** historical/archaeological focus vs. real-time review; the funded incumbents will eat this feature."),
    (6, 5, 5, 7, "An app that quickly creates mock APIs using AI and deploys them. Redis for sample data, random query-param generation. **Comp:** Mockoon (AI assistant shipped), Beeceptor (AI test data from OpenAPI), Mockend, Postman mock, WireMock. **Wedge:** AI-spec-from-prose is already shipped by both Mockoon and Beeceptor — wedge is gone."),
    (7, 6, 7, 8, "A browser that remembers everything you have searched and lets you handle things accordingly. **Comp:** Rewind (Mac screen recorder, EFF-audited), Mem.ai, Arc (sunset 2025 → Dia browser), Dia, Spotlight history. **Wedge:** Arc dying frees some attention; browser-only/lightweight + privacy is real but Dia/Browser Company will move here too."),
    (6, 5, 8, 6, "An agent that deep-dives on a person and finds out almost everything. Once it has full info it trades info from others and verifies from multiple sources, building a source-authenticity framework. **Comp:** Clay (massive funded play), Apollo, OSINT tools (Maltego, SpiderFoot), BeenVerified, PeopleDataLabs. **Wedge:** source-authenticity-from-trades primitive is novel; regulatory risk is real."),
    (7, 4, 5, 8, "A vscode extension that checks your commits before allowing push, via AI. Runs after lint/beautify/build. **Comp:** CodeRabbit ($60M), Greptile ($25M), Bugbot, GitButler review, Codium PR-Agent, Cursor itself. **Wedge:** pre-push (not post-PR) timing is real but every funded incumbent is racing to own it; M_eff ≈ 0."),
    (7, 3, 7, 6, "A chatbot arena where LLMs argue and reach consensus. Multi-agent decomposition of complex reasoning vs. single-model. **Comp:** Chatbot Arena, Poe, LMSYS, debate-style multi-agent papers, Anthropic/OpenAI multi-agent demos. **Wedge:** consensus-protocol angle for harder tasks; research-y, low revenue."),
    (7, 4, 6, 5, "An app that can teach any concept in an interactive story with cartoons. **Comp:** Khanmigo (GPT-4 powered), Brilliant, Synthesis Tutor (K-5), custom GPTs, MagicSchool. **Wedge:** the cartoon/animation pipeline is the differentiator; education monetisation hard for solo."),
    (6, 4, 7, 5, "Build something like wikiboard.org but for the entire net. Click-to-zoom on tab, parallel threads, AI summary, full-page-embed, side-comments on highlights, PDFs too. **Comp:** Glasp, Hypothesis, Recall, Heptabase, Scrintal, tldraw. **Wedge:** the spatial canvas (zoom + parallel) + AI summary — tldraw + AI is moving here."),
    (7, 3, 9, 3, "How to make AI work with a new programming language. Given all syntax + a compiler/test suite, AI iteratively writes code. **Comp:** research-only (FAIR/DeepMind code-LM papers), no productized version. **Wedge:** academic angle + tooling for language designers; not a revenue story."),
    (8, 2, 9, 3, "An on-disk trie of 1M sentences for fast next-word prediction. Disk-resident, child nodes per common prefix. Could find grammar mistakes (no matching path) or be a great suggester. **Comp:** none directly — niche. LLMs subsume the use case for most users. **Wedge:** the *engineering*, not the product."),
    (6, 6, 5, 6, "DB to sheet/notion app — see top entry (duplicate of fluid apps territory). Skip."),
    (6, 5, 5, 8, "An extension that can read everything on the web and lets you query on it. **Comp:** Glasp, Readwise Reader, Notion Web Clipper + AI, Recall, ChatGPT browse, Perplexity. **Wedge:** query-first (not save-first) — Perplexity essentially does this now."),
    (6, 5, 5, 6, "An app that scrapes websites to decipher current mood about fundraises, hiring, scandals. **Comp:** Crayon ($39.5M raised), Klue ($81M raised), Kompyte (budget), Apollo, Clay. **Wedge:** mood/sentiment extraction is the differentiator; CI market is full of well-funded mid-stage players."),
    (6, 6, 5, 7, "A simple web-based SQL table viewer with AI built in. **Comp:** Outerbase (browser-native, ai built-in), Beekeeper Studio, TablePlus + AI plugins, DBeaver, DataGrip, Bytebase. **Wedge:** Outerbase already nails browser-native+AI; shareable links is the remaining gap."),
    (4, 7, 6, 7, "Performance marketing agents — AI agents that run/optimize paid ads end-to-end (creative gen, bid management, audience iteration). **Comp:** AdCreative.ai, Smartly.io, Mutiny, Madgicx (Meta-focused AI Marketer), Pencil, Omneky. **Wedge:** end-to-end automation for solo founders; sales motion is brutal."),
    (5, 5, 5, 6, "Linkedtree-like that shares ad revenue with users. 3 user-company relationship stages (visited/tried/paid). Users earn coins for e-commerce. Built-in analytics like Datafast. Vibe-design pages; import other linkedtree URLs; template marketplace. **Comp:** Linktree (Sponsored Links launched April 2025 — already doing rev-share), Beacons, Bento, Stan. **Wedge:** Linktree shipped the wedge; angle is gone."),
    (5, 6, 7, 5, "An app like pager-duty but for live orders. **Comp:** PagerDuty, Opsgenie, BetterStack, custom Slackbots. **Wedge:** order-flow-specific (sub-minute SLA monitoring for fulfilment teams) — vertical SaaS, real but small TAM."),
    (5, 4, 5, 7, "Website recommender — share history/bookmarks; get sample sites you'd like. Plus a URL shortener with super analytics. Every click shows a recommended-sites loader. **Comp:** Bitly, Dub.co (open-source darling), Datafast, Short.io, Stumbleupon vibe (dead). **Wedge:** rec-engine inside the shortener; weak."),
    (5, 5, 5, 6, "A tool that feeds an entire repo to an LLM in a readable way. Just give a github link and get a review. **Comp:** Greptile, CodeRabbit, Repomix, ingest-cli, gitingest.com, code2prompt. **Wedge:** zero-config, public-link-only mode — gitingest already does this for free."),
    (4, 4, 5, 4, "Create a directory maker for fun. Release a bunch of directories (AI Wrapper directory etc). Same DB; collaborative voting; vote-based visibility. **Comp:** ProductHunt, There's an AI for that, Beautiful Public Data, Futurepedia. **Wedge:** vote-driven curation + many sub-directories — SEO play, low ceiling."),
    (4, 5, 5, 5, "Directory as a marketplace for domain selling. DNS verification, auction system, backlinks. **Comp:** GoDaddy Auctions, Sedo, Dan.com, Namecheap Marketplace. **Wedge:** vertical (e.g. only AI domain auctions)."),
    (4, 4, 4, 4, "Why don't people selling SaaS have a bid system? Bidders profile (social verification). Gamify: bids placed, bids won, payment count. **Comp:** MicroAcquire (Acquire.com), Flippa, Tiny — those are acquisitions not bidding for product instances. **Wedge:** live-bid-and-buy model; thin demand."),
    (5, 4, 4, 5, "Summarise threads — twitter, reddit etc. **Comp:** ThreadReaderApp, TweetHunter, native X (Grok) summary, ChatGPT with browse. **Wedge:** cross-platform + topic clusters; X owning summaries via Grok kills standalone value."),
    (5, 5, 5, 9, "A super app to help you prepare for tests, integrate AI questioning, anki notes, extremely personalised. **Comp:** Quizlet (AI-powered now), Anki + plugins, RemNote, Brainscape, Synthesis Tutor, Khanmigo. **Wedge:** AI-personalisation alone is no longer differentiated; vertical-test focus (e.g. USMLE, JEE) needed."),
    (5, 5, 5, 7, "A browser extension that fills all forms for you (regular forms, post/comment creation). Beyond what browsers already do. **Comp:** browsers (autofill), Magical, 1Password, autofill plugins, Arc Max, AI form-fillers like FormWise. **Wedge:** generative — drafts posts/comments contextually."),
    (4, 6, 6, 8, "RAG is mostly data prep. Maybe buy something like Memoryrag.com. Post-training studying + inference optimisation. **Comp:** LlamaIndex ($27.5M total, Series A May 2025), LangChain, Unstructured.io, Vectara, Ragie, Pinecone Assistant. **Wedge:** vertical RAG-as-a-service; horizontal layer is taken."),
    (4, 3, 4, 4, "Verified-tweet screenshot tool. Use a tool like tweethunter.io/tweetpik to generate screenshot + share. Or browser ext that lets you tweet-as-image directly. **Comp:** TweetHunter, Tweetpik, Poet.so, native X screenshots. **Wedge:** verification (cryptographic proof + ledger) is novel but no demand signal."),
    (4, 3, 4, 7, "An app integrated in SH for book/movie recommendations within groups. **Comp:** Letterboxd, Goodreads (Amazon-owned), Hardcover, Storygraph. **Wedge:** group/friends-only recs; thin moat."),
    (5, 3, 5, 8, "EverythingRated.com — rate anything on any aspect. Users create aspects, categories, things. **Comp:** Reddit itself, dedicated rating sites per vertical (Yelp/IMDB/Rotten/G2). **Wedge:** mostly content quality / community; hard cold start."),
    (3, 6, 4, 8, "A dedicated app for lawyers / CA / professionals — like Practo for health. Plumber, carpenter etc. Voice prompts to reduce friction. **Comp:** Practo, JustDial, UrbanCompany, Sulekha, Apna. **Wedge:** voice-prompt onboarding for tradespeople; sales motion is brutal."),
    (3, 5, 4, 7, "An app to book transport for local tourism. Many packages, tourist target audience, partner with agencies. MMT-but-taxis. **Comp:** MMT, GoIbibo, Yatra, Booking, Klook, GetYourGuide. **Wedge:** taxi-vertical only + AI-generated itineraries."),
    (4, 3, 4, 4, "An app for panic — provides less options, learns what suits the user, personalised care. Can extend for old people. **Comp:** Headspace, Calm, Wysa, Woebot, Notion's emerging mental health entrants. **Wedge:** crisis-moment-only mode."),
    (4, 3, 4, 6, "Tier-list app where people can vote. Consider merging with storytunes / everythingRated. **Comp:** tiermaker.com, Tierlists.com. **Wedge:** real-time collaborative voting (storytunes-style)."),
    (5, 3, 4, 5, "Temp splitwise (can also host lists and shit) — https://github.com/sarthakagrawal927/temp-splitwise. _(shipped)_ **Comp:** Splitwise, Settle Up, Tricount. **Wedge:** no-account/temp-room angle."),
    (6, 2, 5, 7, "Shareable music list with realtime DnD editing across sources — https://github.com/sarthakagrawal927/musicDnD. _(shipped)_ **Comp:** Spotify collaborative playlists, Apple Music shared, Songbird, Soundiiz. **Wedge:** cross-platform merging (Spotify+YouTube+Apple)."),
    (4, 3, 4, 7, "Location tracking app — https://github.com/sarthakagrawal927/location-tracker-app. _(shipped)_ **Comp:** Life360, Find My, Google Family Link, Zenly (dead → Snap Map). **Wedge:** zero-account, link-share-only."),
    (6, 5, 4, 6, "An app to find relevant places based on user feedback — nomad-list-style for other things — https://github.com/sarthakagrawal927/maps-server. _(shipped)_ **Comp:** Nomad List, Wanderlog, Atlas Obscura. **Wedge:** vertical-specific (e.g. \"best cafes to work from\")."),
    (3, 5, 4, 6, "An app to understand users' needs — can be used to sell software/medicine/cosmetics/clothes/food. **Comp:** UserInterviews, Maze, Lookback, Sprig, dscout, PostHog surveys. **Wedge:** AI-conducted interviews + analysis pipeline — Sprig+PostHog already moved here."),
    (5, 2, 4, 5, "An app that summarises git commits and posts to Twitter (also a tweet scheduler bot). https://github.com/jnsahaj/lumen — exists. **Wedge:** none if you don't build a community around it."),
    (4, 6, 6, 7, "An app that analyses stock data to determine purchases by health (short/long term). **Comp:** Koyfin, Simply Wall St, Stock Rover, TradingView, Gainify, Fiscal.ai. **Wedge:** AI-driven (\"explain this stock in plain English\") — most incumbents shipped this in 2025."),
    (4, 4, 4, 7, "An app to have maps for everything — start with rental properties; users add scenery/food/sunset/lit-area pins. **Comp:** Google Maps, MapMyIndia, OSM-based apps, Atlas Obscura, Citymapper. **Wedge:** community-curated pins per vertical."),
    (3, 5, 4, 5, "Application to help companies track employee location and assign tasks. **Comp:** Hubstaff, Time Doctor, Skedulo, Connecteam. **Wedge:** specifically for field-service teams (delivery/utilities)."),
    (3, 4, 5, 8, "Start a business with payment integration. Provide people with no business a way to collect money. Send earned amount as contractual pay. **Comp:** Stripe Atlas, Razorpay, Cashfree, UPI apps, Doola, Mercury. **Wedge:** none in markets with mature UPI; Stripe Atlas owns rest."),
    # Games
    (5, 5, 5, 8, "Tambola with real money — custom rooms with/without. Like the IPL betting game. **Comp:** Indian gaming apps (MPL, Dream11, Winzo, Zupee). **Wedge:** regulatory/legal challenge in India (2023 28% GST on gaming changed economics)."),
    (5, 3, 4, 5, "Phone-time control: answer questions to unlock, difficulty rises with usage count; sets daily time and decreases contrast over the day. **Comp:** Opal, OneSec, ScreenZen, Brick. **Wedge:** the question-answering ritual is novel."),
    (4, 2, 4, 6, "Anti Chess App. **Comp:** chess.com Anti-Chess, lichess. **Wedge:** none."),
    (4, 2, 4, 7, "Monopoly Game. **Comp:** Hasbro official digital, Monopoly Go (mega-hit), Catan-style clones."),
    (5, 3, 5, 6, "Catan at larger scale online for companies — more bricks, dice numbers can repeat. **Comp:** Catan Universe, Board Game Arena. **Wedge:** company/team-building format."),
    (4, 3, 4, 5, "A dashboard filled with mini-games. **Comp:** Poki, CrazyGames, itch.io."),
    (7, 3, 5, 4, "Poker with stakes of tasks instead of money. Others assign you tasks, value set by consensus. Like truth-and-dare for poker. **Comp:** none direct. **Wedge:** social-stakes mechanic — fun but no monetization."),
    (4, 1, 4, 3, "JS implementation of the glasses-matching game. **Comp:** none."),
    (4, 3, 4, 5, "Small web-games directory. **Comp:** Poki, CrazyGames, itch.io."),
    (5, 1, 5, 3, "Build a project using t3-app and party-kit. _(tech demo, not a product)_"),
    (5, 4, 5, 6, "Reels + games combo — swipe to play a new game or next level. Reels on the side. Submit-your-own games. **Comp:** Roblox, Tappy, TikTok mini-games, Snap Games. **Wedge:** TikTok-format game discovery — platforms own this."),
    (6, 3, 5, 5, "Chrome extension to download blogs as PDF. Use AI to add tailwind classes for prettier rendering. **Comp:** SingleFile, Pocket, save-as-PDF, Reader-mode tools, Readwise Reader. **Wedge:** the AI re-styling is the unique angle."),
]

# ---------------------------------------------------------------------------
# Specs
# ---------------------------------------------------------------------------

SPEC_IDEAS = [
    (7, 5, 8, 9, "FamilyTree. Social tree + auth + giftme + matrimonial + commerce + genetic angles. **Comp:** Ancestry ($1.3B rev/$10B mooted exit), MyHeritage, FamilySearch (free), Geni (200M profiles), WikiTree (free volunteer). **Reality:** records/DNA owned by incumbents; free/social owned by FamilySearch+WikiTree; MyFamily.com (the social-tree play) already shuttered in 2014. Spec scope is unshippable solo. **Wedge:** thin — maybe diaspora-Indian matrimonial-meets-tree only."),
    (7, 6, 7, 9, "magicform. AI-built forms with realtime/2-way comms + SDK embed. **Comp:** Typeform ($141M ARR, $935M val), Jotform ($145M, bootstrapped), Tally ($4M ARR, bootstrapped, aggressive free tier eating the low end), Fillout ($19/mo w/ AI built-in), Google Forms (47% share). **Reality:** every incumbent shipped AI form generation in 2024-25; the 'AI builds forms' wedge is gone. Pricing race-to-zero. **Wedge:** 2-way comms + embeddable SDK is real but niche."),
    (8, 5, 8, 9, "Productivity App. Life-OS combining habits, schedule, goals, journal, social mode. **Comp:** Notion ($400M ARR), Todoist (50M users), Motion ($50M ARR, $550M val, $75M raised), Sunsama, Akiflow, Habitica, Streaks, Habitify. **Reality:** life-OS scope graveyard — flexibility (Notion templates) consistently beats opinionated all-in-one. Spec is ~3 years of solo work. The dev will be the only user. **Wedge:** none defensible; build only if it's your daily driver."),
    (8, 3, 7, 4, "StoryTunes. Multiplayer story engine with canon voting + AI co-authors. **Comp:** Storium (crowdfunded 2014, tiny), Storyfall (solo indie), PlotVote, Mycelore (preview), Sudowrite ($1.8M ARR after 5yrs, bootstrapped), NovelAI (subs only), AI Dungeon (-46% players Feb25→Apr26). Wattpad ($895M rev) owns social-serialized but not multiplayer. **Reality:** lane is open — no funded incumbent in voted-canon-multiplayer. But the cat is small (Sudowrite at $1.8M tells you ceiling). **Wedge:** real; monetization is the question."),
]

# ---------------------------------------------------------------------------
# Solopreneur — category-based C baselines applied to scraped entries
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Fresh ideas (outside the original backlog) — generated to fit the brief:
# tech-heavy (T>=7), non-dev customer, $5K MRR achievable, solo-feasible,
# real wedge against incumbents. Each tuple has explicit F_feas and customer.
# ---------------------------------------------------------------------------

FRESH_IDEAS = [
    # (F, M, T, C, F_feas, customer, title, body)
    (7, 7, 7, 4, 6, "non-dev",
     "Construction daily report automation",
     "Foremen take phone photos + voice notes; AI generates compliance-ready daily logs (weather, headcount, work completed, safety incidents) as branded PDFs. **Comp:** Procore, Buildertrend are heavy ERPs; lightweight AI-first reporting is open. **Wedge:** target the 1–10-employee general contractor who can't justify Procore's $7K/yr. $100/site/mo × 50 sites = $5K MRR. Tech: vision-LM on photos + voice-to-text + template engine."),
    (7, 6, 7, 5, 6, "non-dev",
     "Home inspector report automation",
     "Photos + voice notes → branded customer-ready inspection PDFs with defect categorization, severity, and repair-cost ranges. **Comp:** Spectora (~$60/mo), HomeGauge — established, but AI-first photo workflow is the wedge. **Wedge:** 5× faster report generation. Each inspector does 5–15 reports/wk; $79/mo × 65 inspectors = $5K MRR. Tech: vision-LM defect detection + RICS-style template engine."),
    (8, 6, 8, 4, 5, "non-dev",
     "AI hyperlocal newsletter automation",
     "For citizen-journalists & local-newsletter ops: scrapes Reddit, city council minutes (PDFs!), event sites, local news; dedups across sources; drafts neighborhood/city newsletter with embedded sources. **Comp:** none doing the *sourcing* — beehiiv/Substack are publishing tools, not content engines. **Wedge:** the data pipeline. $50–100/mo × 50–100 ops = $5K MRR. Tech: distributed scrapers + LLM synthesis + dedup + scheduling."),
    (7, 6, 7, 6, 6, "non-dev",
     "AI personal CRM with auto-drafted check-ins",
     "\"Haven't talked to X in 90 days — here's a draft message based on past context.\" Reads email + calendar, builds a relationship graph, surfaces who's slipping. **Comp:** Dex, Clay (B2B-focused), Monica. **Wedge:** auto-draft with past-context memory is the gap — others just remind. $10–30/mo prosumer/exec. 200 users at $25/mo = $5K MRR. Tech: email/calendar ingest + relationship graph + RAG drafting."),
    (8, 6, 8, 6, 5, "non-dev",
     "Voice memo → publish pipeline",
     "Record an idea; get published-ready blog post / newsletter / Twitter thread / LinkedIn post in your tone, with auto-pulled images/quotes. **Comp:** Castmagic ($23/mo), Cleft, Audiopen ($9/mo) — growing but specific *format-per-output* + tone-cloning is open. **Wedge:** style-transfer per channel + auto-image. $20/mo × 250 creators = $5K MRR. Tech: ASR + style-transfer + multi-format generation."),
    (6, 7, 7, 6, 5, "non-dev",
     "Etsy / Shopify niche listing optimizer",
     "Upload a listing; get per-niche SEO scoring vs top sellers, photo enhancement, pricing recommendation, copy rewrite. **Comp:** eRank ($6/mo), Marmalead — keyword-only tools; AI-first generation is the gap. **Wedge:** per-niche tuning (jewelry vs digital products vs apparel). $30/mo × 170 sellers = $5K MRR. Tech: scraping top-seller signals + vision + LLM generation."),
    (4, 7, 7, 4, 5, "non-dev",
     "Memorial / obituary site generator for funeral homes",
     "Funeral homes upload photos + bio; get a branded memorial page with comments, donation links, livestream embed. White-label per home. **Comp:** Tributes.com (Legacy.com — dominant but ugly), Ever Loved. **Wedge:** clean modern UX + AI-written tribute drafts. $50/mo per home × 100 homes = $5K MRR. Tech: white-label SaaS + media handling."),
    (7, 5, 8, 5, 4, "non-dev",
     "AI fact-checker / source surfacer for journalists",
     "Paste a claim or article; get verified counter-sources with credibility scoring + key quotes. **Comp:** Originality.ai (plagiarism-focused), Logically (enterprise), Snopes (manual). **Wedge:** journalist/researcher tier at $30/mo with API access. 170 users = $5K MRR. Tech: source retrieval + cross-document NLI + credibility ranking."),
]

CAT = {
    # Tech-first categories (T bumped to 7+ so they pass the T>=7 filter)
    'gpt-wrapper-ideas':                              (7, 8, 8, 'GPT Wrappers'),
    'micro-saas-ideas':                               (6, 7, 7, 'Micro SaaS'),
    'solo-developer-ideas':                           (6, 7, 7, 'Solo Developer'),
    'automation-ideas':                               (6, 7, 7, 'Automation'),
    'digital-product-ideas':                          (6, 7, 7, 'Digital Products'),
    'freemium-and-open-source-ideas':                 (6, 7, 7, 'Freemium / Open Source'),
    'plugins':                                        (6, 7, 6, 'Plugins'),
    'm2m-by-makers-for-makers':                       (7, 7, 6, 'Makers for Makers'),
    # Mixed / case-by-case (left at non-tech-first baseline — will be filtered out)
    'greatest-hits':                                  (6, 4, 7, 'Greatest Hits'),
    'solopreneur-ideas':                              (6, 4, 7, 'Solopreneur'),
    'productized-services':                           (4, 3, 6, 'Productized Services'),
    'weekend-projects':                               (7, 3, 5, 'Weekend Projects'),
    'apps-so-simple':                                 (6, 3, 6, 'Apps So Simple'),
    'one-page-websites':                              (4, 2, 7, 'One-Page Sites'),
    '1m-shovels':                                     (5, 3, 7, '$1M Shovels'),
    'no-audience-required':                           (7, 3, 5, 'No Audience Required'),
    'ideas-you-can-build-today-with-no-code-tools':   (4, 2, 7, 'No-Code Ideas'),
    'bubble-ideas':                                   (4, 2, 6, 'Bubble Ideas'),
    'no-code-ideas':                                  (4, 2, 6, 'No-Code'),
    'problems':                                       (5, 5, 5, 'Real Problems'),
    'marketplaces':                                   (4, 5, 7, 'Marketplaces'),
    'david-vs-goliath':                               (4, 3, 5, 'David vs Goliath'),
    'weird-but-profitable-ideas':                     (5, 3, 3, 'Weird but Profitable'),
}
SOL_DROP = {'sitemap','travel-and-digital-nomad-ideas','niche-blog-ideas','niche-sites','launched-with-website-builder'}

def m_from_revenue(rev):
    if not rev: return 2
    r = rev.strip()
    if not r or r=='?': return 2
    m = re.search(r'\$([\d.]+)\s*([KMB])?', r, re.I)
    if not m: return 2
    n = float(m.group(1))
    suf = (m.group(2) or '').upper()
    if suf == 'B': mo = n * 1e9
    elif suf == 'M': mo = n * 1e6
    elif suf == 'K': mo = n * 1e3
    else: mo = n
    if mo >= 100_000: return 9
    if mo >= 10_000:  return 7
    if mo >= 1_000:   return 5
    return 3

def m_eff(M, C):
    return max(M - max(C - 3, 0), 0)

def adj_sum(F, M, T, C):
    return F + m_eff(M, C) + T

def is_active(F, M, T, C):
    return max(F, m_eff(M, C), T) >= 8

# ---------------------------------------------------------------------------
# Load retained solopreneur source data
# ---------------------------------------------------------------------------

def fetch_sol():
    return json.loads((ROOT/'ideas'/'data'/'solopreneur_ideas.json').read_text())

# ---------------------------------------------------------------------------
# Build master list
# ---------------------------------------------------------------------------

all_items = []  # list of dicts

for F, M, T, C, title, body in AI_IDEAS:
    all_items.append({'f':F,'m':M,'t':T,'c':C,'idea':f"**{title}.** {body}",'source':'ai-ideas'})
for F, M, T, C, body in README_IDEAS:
    all_items.append({'f':F,'m':M,'t':T,'c':C,'idea':body,'source':'README'})
for F, M, T, C, body in SPEC_IDEAS:
    all_items.append({'f':F,'m':M,'t':T,'c':C,'idea':body,'source':'spec'})
for F, M, T, C, F_feas, customer, title, body in FRESH_IDEAS:
    all_items.append({
        'f':F,'m':M,'t':T,'c':C,
        'idea':f"**{title}.** {body}",
        'source':'fresh',
        # pre-populated so the dict-based lookups below don't override
        '_pre_feas':F_feas, '_pre_feas_why':"Fresh idea — feasibility hand-set on add.",
        '_pre_customer':customer,
    })

# Starterstory: include only entries with revenue >= $5K/mo AND from
# tech-first categories (tech-first means T_baseline >= 7 in CAT above).
def revenue_per_month(rev_str):
    """Parse '$1M/month' or '$3K/month' → number of $/month. 0 if unknown."""
    if not rev_str or rev_str.strip() in ('', '?'): return 0
    m = re.search(r'\$([\d.]+)\s*([KMB])?', rev_str, re.I)
    if not m: return 0
    n = float(m.group(1))
    mult = {'B': 1e9, 'M': 1e6, 'K': 1e3, '': 1}[(m.group(2) or '').upper()]
    return n * mult

# Boilerplate prefixes Starterstory founder interviews use. Strip these to
# get to the actual product description.
_BOILERPLATE = [
    r"^[Hh](?:ello|i|ey)[,!]?\s*[Ww]ho are you (?:and what (?:are you (?:working on|building)|business did you start))?\??",
    r"^What's up\s*everyone[!,]?\s*[Ww]ho are you[^?]*\??",
    r"^[Hh](?:ello|i|ey)[,!]?\s*[Mm]y name is [^.,]+[,.]?",
    r"^[Ii]'?m\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?[,.]?",
    r"^(?:Hello|Hi|Hey)[!,]?\s*",
    r"^[Tt]hank(?:s| you) for (?:having me|the opportunity)[!.]?",
    r"^[Ww]ell[,]?\s*",
]

def extract_description(story_intro, title, customers, page_title):
    """Return a clean 1-2 sentence product description from the Starterstory
    founder interview. Falls back to title + customers if story_intro is weak."""
    if not story_intro:
        return f"_{title}._" + (f" Targets: {', '.join(customers[:2])}." if customers else "")
    text = story_intro.strip()
    # Iteratively strip common boilerplate prefixes
    changed = True
    while changed:
        changed = False
        for pat in _BOILERPLATE:
            m = re.match(pat, text)
            if m:
                text = text[m.end():].lstrip(' .,!\n')
                changed = True
    # Stop at the first sign of marketing fluff ("our flagship products", "We are excited", etc.)
    # Take the first ~280 chars, ending at a sentence boundary if possible.
    if len(text) > 280:
        cut = text[:280]
        # try to end at the last full sentence
        last = max(cut.rfind('. '), cut.rfind('! '), cut.rfind('? '))
        if last > 120:
            text = cut[:last+1]
        else:
            text = cut.rstrip() + "…"
    return text.strip()

MIN_REVENUE = 5000  # $5K/month
# Pre-researched descriptions (built by parallel agents that fetched each
# starterstory case-study URL and produced clean 1-2 sentence summaries).
# Keyed by URL. Falls back to extract_description() if a URL isn't here.
try:
    SS_DESCRIPTIONS = json.loads((ROOT/'ideas'/'data'/'starterstory_descriptions.json').read_text())
except FileNotFoundError:
    SS_DESCRIPTIONS = {}
sol = fetch_sol()
sol_dropped_revenue = 0
sol_dropped_nontech = 0
for x in sol:
    src = x.get('source')
    if src in SOL_DROP or src not in CAT: continue
    Fb, Tb, Cb, label = CAT[src]
    if Tb < 7:                           # non-tech-first category (matches MIN_T downstream)
        sol_dropped_nontech += 1; continue
    rev_mo = revenue_per_month(x.get('revenue'))
    if rev_mo < MIN_REVENUE:             # <$5K/mo
        sol_dropped_revenue += 1; continue
    M = m_from_revenue(x.get('revenue'))
    title = (x.get('title') or '').strip() or '(untitled)'
    rev   = (x.get('revenue') or '?').strip() or '?'
    co    = (x.get('company_name') or '').strip()
    url   = (x.get('url') or '').strip()
    co_part = f" — {co}" if co else ''
    link = f" [story]({url})" if url else ''
    desc = SS_DESCRIPTIONS.get(url) or extract_description(
        x.get('story_intro') or '',
        title,
        x.get('customers') or [],
        x.get('page_title') or '',
    )
    idea = f"**{rev}** — **{title}**{co_part} _({label})_{link}<br>{desc}"
    all_items.append({
        'f':Fb,'m':M,'t':Tb,'c':Cb,'idea':idea,'source':'starterstory',
        '_pre_customer':'non-dev',  # external case studies; not your build to sell to devs
    })
print(f"Starterstory: kept {sum(1 for x in all_items if x['source']=='starterstory')}; "
      f"dropped {sol_dropped_revenue} for <$5K/mo, {sol_dropped_nontech} for non-tech-first category")

# Two derived scores will be computed AFTER F_feas + customer are stamped
# (see below). Just declare MIN_T here for the filter that comes next.
MIN_T = 7  # filter: drop ideas that aren't tech-heavy

# Hard filter: drop non-tech-heavy ideas from the data entirely.
before = len(all_items)
all_items = [x for x in all_items if x['t'] >= MIN_T]
print(f"Filtered to T >= {MIN_T}: kept {len(all_items)} of {before}")

# Feasibility for a solo dev /10. 1 = needs $10M and a sales team.
# 10 = solo can ship V1 in a weekend with self-serve distribution.
# Considers: capital required, distribution motion, cold-start network effects,
# time-to-MVP, sales cycle, incumbent moats already locked in.
FEAS = {
    # (substring → (F_feas, one-line reasoning))
    "An app that animates manga":         (2, "Massive ML compute + video models + dataset + voice consistency at scale. Not solo-shippable."),
    "Trustworthy automation infra":       (2, "Theme, not product. Even narrow vertical needs deep enterprise relationships."),
    "Time-series geographical heatmap":   (4, "Tractable to demo; B2B analytics sales is brutal for solo."),
    "B4 — AI step-through debugger":      (6, "Devtool, solo can ship; OSS-launch + dev community is a real distribution path."),
    "DB → sheet/notion app with git-style":(3, "Years of UX work to match Notion + merge correctness. B2B sales motion."),
    "Bizarre idea: fluid apps":           (4, "Tech tractable; distribution against Lovable/Bolt's $200M+ funding is brutal."),
    "An on-disk trie":                    (8, "Weekend project, ships as OSS. Not a business but a real artifact."),
    "How to make AI work with a new programming":(3, "Pure research, no product path or market."),
    "A website that tells you the time complexity":(7, "Weekend project, niche devtool, freemium/$5-mo viable."),
    "A2 — Legacy code resurrection":      (2, "Enterprise sales, Fortune 500 access, multi-month cycles. Consulting is solo-doable but not a product."),
    "AI analytics company":               (2, "Brutal market (PostHog $1.4B); multi-year build; B2B sales."),
    "Build a minimalist graph library":   (8, "OSS library, weekend-to-month, devs install for themselves. M near zero."),
    "Open world game with AI characters": (3, "Game dev complexity, marketing, content moderation, scaling AI costs."),
    "Pluggable recommendation system":    (3, "SDK distribution + B2B sales + Algolia/Recombee free tiers undercut."),
    "Productivity App — [spec]":          (2, "3-year solo build per the deep-dive; Notion+Motion own the lane."),
    "An app that lets you build walkable 3D worlds":(3, "Game-engine complexity vs Roblox/Spatial install base."),
    "FamilyTree — [spec]":                (2, "Multi-year build vs Ancestry/MyHeritage; per deep-dive, essentially dead."),
    "An agent that deep-dives on a person":(4, "Legal/OSINT risk + B2B sales for revenue. Solo prototype OK; ship-to-revenue hard."),
    "Scalable n8n alternative":           (2, "Fighting n8n at $2.5B + NVIDIA on their turf."),
    "Interoperability / data plumbing":   (2, "Theme. Fivetran/Census just consolidated; enterprise sales required."),
    "StoryTunes — [spec]":                (5, "Solo can build the engine; cold-start on multiplayer fiction is hard but doable with hand-curation."),
    "A SM with personality bots":         (3, "Cold-start network effects, content moderation, AI costs at scale."),
    "Storytunes. Multi-author":           (5, "Same as the spec — solo-buildable, distribution is the open question."),
    "Let old machines be used as a server":(6, "Niche infra OSS project; devs interested; weak revenue but solo-shippable."),
    "Tree Visualizer":                    (5, "Small product, niche audience, OSS-ish, hard to monetize."),
    "AI social media with named personas":(3, "Same as SM bots — cold-start + moderation + AI scaling."),
    "A browser that remembers everything you have searched":(4, "Tractable but Rewind/Dia/Limitless funded and incumbent."),
    "C2 — Screen / browser copilot":      (4, "Cluely at $7M ARR with $20M funding sucked the oxygen out post-2025."),
    "A chatbot arena where LLMs argue":   (5, "Research-y, OSS-friendly, low monetization but solo can ship."),
    "magicform — [spec]":                 (3, "Form market saturated + every incumbent shipped AI gen + Tally's free tier."),
    "An app like pager-duty but for live orders":(5, "Vertical SaaS — small TAM but real; solo can build + sell into one industry."),
    "A1 — Synthetic user QA tester":      (4, "QA Wolf/Mabl/Octomind funded; solo can build but engineering-team distribution hard."),
    "Build something like https://www.wikiboard.org":(5, "Tech tractable, niche audience, OSS-ish."),
    "Analyses GitHub repository history": (4, "Devtool, solo can build; distribution against Greptile $25M/CodeRabbit $60M hard."),
    "Personal knowledge assistant":       (5, "Solo can build the primitive; standalone monetization unclear; better as a feature."),
    "C1 — LLM experiment / routing hub":  (3, "OpenRouter $500M val owns marketplace; LiteLLM owns OSS proxy."),
    "Lightweight observability + logs framework":(2, "Datadog/Sentry/Axiom/BetterStack — brutally consolidated."),
    "CCTV app customisable for special queries":(3, "Verkada owns hardware buyers; software-only B2B sales is brutal."),
    "B1 — AI log / incident copilot":     (3, "Datadog Bits AI shipped, every incumbent racing; log-volume costs kill solo."),
    "A3 — Deep-dive investment analyst":  (3, "AlphaSense $4B with data licensing moat; solo can't get the data."),
}

# Stamp F_feas on each item (use pre-populated value if present)
for x in all_items:
    if '_pre_feas' in x:
        x['f_feas']     = x.pop('_pre_feas')
        x['f_feas_why'] = x.pop('_pre_feas_why')
        continue
    feas, why = 4, ""  # default for unmatched
    for needle, (score, reason) in FEAS.items():
        if needle in x['idea']:
            feas, why = score, reason; break
    x['f_feas']     = feas
    x['f_feas_why'] = why

# Customer type. "dev" = individual devs (hardest to monetize — they think
# they can build it themselves). "b2b-tech" = companies buy for tech teams
# (real motion, but slower). "non-dev" = everyone else (prosumers, vertical
# ops, students, writers, recruiters — usually easier to extract $).
CUSTOMER = {
    # dev-individual
    "An on-disk trie":                   "dev",
    "Build a minimalist graph library":  "dev",
    "A website that tells you the time complexity": "dev",
    "Let old machines be used as a server": "dev",
    "A chatbot arena where LLMs argue":  "dev",
    "Analyses GitHub repository history":"dev",
    "How to make AI work with a new programming": "dev",
    # b2b-tech (companies buy for tech teams)
    "B4 — AI step-through debugger":     "b2b-tech",
    "A1 — Synthetic user QA tester":     "b2b-tech",
    "B1 — AI log / incident copilot":    "b2b-tech",
    "C1 — LLM experiment / routing hub": "b2b-tech",
    "AI analytics company":              "b2b-tech",
    "Pluggable recommendation system":   "b2b-tech",
    "Scalable n8n alternative":          "b2b-tech",
    "Lightweight observability":         "b2b-tech",
    "Trustworthy automation infra":      "b2b-tech",
    "Interoperability / data plumbing":  "b2b-tech",
    "DB → sheet/notion app with git-style":"b2b-tech",
    "A2 — Legacy code resurrection":     "b2b-tech",
    "magicform — [spec]":                "b2b-tech",
    # non-dev (everything else: prosumer, vertical, student, writer, ops, etc)
}
for x in all_items:
    if '_pre_customer' in x:
        x['customer'] = x.pop('_pre_customer')
        continue
    ctype = "non-dev"
    for needle, c in CUSTOMER.items():
        if needle in x['idea']:
            ctype = c; break
    x['customer'] = ctype

# Two derived scores per user spec:
#   fun   = F + T            (range 2..20)
#   money = M + F_feas - C   (range -8..19, practical -3..17)
for x in all_items:
    x['fun']   = x['f'] + x['t']
    x['money'] = x['m'] + x['f_feas'] - x['c']
    # legacy fields kept in data for tooltip/debug only
    x['m_eff'] = m_eff(x['m'], x['c'])
    x['adj']   = x['fun'] + max(x['money'], 0)

# Best bet: strong on at least one of the two collapsed axes, AND not
# selling to individual devs.
#   fun   >= 14 (= e.g. F7 T7, or F8 T6) OR
#   money >= 5  (clear positive after competition penalty)
for x in all_items:
    x['best_bet'] = (
        x['customer'] != 'dev' and
        (x['fun'] >= 14 or x['money'] >= 5)
    )
    x['best_bet_why'] = x['f_feas_why'] if x['best_bet'] else ''

# Sort: best_bet first, then by money desc, then fun desc
all_items.sort(key=lambda x: (-int(x['best_bet']), -x['money'], -x['fun']))
print(f"Total {len(all_items)} | best bets: {sum(x['best_bet'] for x in all_items)} | "
      f"fun max {max(x['fun'] for x in all_items)} | money max {max(x['money'] for x in all_items)}")

# ---------------------------------------------------------------------------
# Write the checked-in route dataset
# ---------------------------------------------------------------------------

(ROOT/'src'/'data'/'ideas.json').write_text(
    json.dumps(all_items, indent=2) + "\n",
    encoding="utf-8",
)
print("Wrote src/data/ideas.json")
