# Status

SaaS Maker source is reduced to three surfaces: the public directory, the
feedback API/inbox, and the reusable packages. Package and service documentation
is maintained as checked-in Markdown instead of a separate application.

Local checks are green on `c5d3e845`. Production API is serving the agent
contract at api.sassmaker.com. The inbox Worker is deployed and
app.sassmaker.com resolves via a Worker custom domain. npm publication of
`@saas-maker/feedback` still needs registry credentials.

No production deployment, migration, DNS change, npm action, or repository
archival has been performed.
