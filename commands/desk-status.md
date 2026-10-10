---
description: Which plugin version this machine loaded, whether the office approved it, and the latest release
---

1. Run `node lib/status.mjs` (from the plugin directory; pass the repo path if you are
   elsewhere). One line: the version loaded here, whether office.json `plugin.approved` lists
   it (and whether `enforce` refuses desks on it), and the latest release on GitHub ("unknown"
   when it cannot be fetched, never "up to date"). Exit 4 when the loaded version is not
   approved.
2. Read the line to the user as it is. If the version is not approved, say who decides (the
   lead), not what to install.

⛔ Do not work around it by reading `installed_plugins.json` or running `claude plugin update`
to "fix" a mismatch. An office holds its version on purpose: an update changes the wall in every
new session, and only the lead approves that.
