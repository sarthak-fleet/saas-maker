# Publishing contract

The owning product repository remains authoritative.

1. Read its instructions and status before editing.
2. Reuse its existing content collection, components, metadata, URL conventions,
   package manager, and checks.
3. Make the smallest coherent change and preserve unrelated work.
4. If an article surface is missing, create a separate spec-driven plan and put
   that exact plan in the campaign preview.
5. Treat each repository write, validation, commit, push, and deploy as a
   distinct manifest item. Approval of one does not imply an omitted action.
6. Recompute the manifest hash before each action.
7. Record the resulting file paths, revision, check result, remote revision, or
   live canonical URL as the receipt evidence.

Research, drafting, and preview do not authorize repository writes. Repository
writes do not authorize commit/push. Commit/push do not authorize production
deployment unless the exact deploy action appears in the approved manifest.
