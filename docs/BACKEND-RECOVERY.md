# Backend availability and recovery

Updated October 22, 2026. See HANDOFF.md for the incident and verified deployment.

## Active detection

The homepage check does not establish backend health. Cloud Monitoring now also sends
an empty, unauthenticated JSON POST to these original us-central1 callables every 60 seconds:

- saveTour: `mrt-backend-savetour-hzFHqDzHgy4`
- submitIntake: `mrt-backend-submitintake-SfguvSzO17c`
- submitRating: `mrt-backend-submitrating-SfguvSzO0D4`

Each requires HTTP 401 and `UNAUTHENTICATED` in the body. This proves the runtime and
callable authentication layer respond, without credentials, records or outbound emails.
It does **not** test database writes, admin authorization, browser CORS or email delivery.
Existing homepage and backend ERROR-log alerts remain enabled.

Policy `11025209441887969144` alerts the existing Erik-only channel
(`erik@marketreadysystems.ai`) when any one endpoint fails from at least two checker
locations for two minutes. Probes run in Oregon, Virginia and Europe. Detection and email
arrival also depend on metric ingestion and notification delivery; two minutes is the
condition duration, not a delivery guarantee. Do not claim alert email receipt until tested.

Preview the reproducible configurations with:

```
python3 scripts/configure-backend-monitoring.py
```

`--apply` creates missing named checks and the policy using current gcloud credentials.
Existing checks must match; existing policy is retained for manual review. Do not add real
user tokens or data to these probes. Monitoring POST body format and response validation:
https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.uptimeCheckConfigs

## Protecting work during an outage

Add Listing and Attendance's Add a listing keep text drafts in sessionStorage, keyed by
signed-in organizer and tour/request. Same-tab refresh restores them for up to 24 hours;
closing the tab, clearing browser storage or a storage failure can lose the draft.
Cancel and confirmed saves clear it. Failed saves retain fields and the listing ID.
Already-uploaded HTTPS photo URLs are retained; local/base64 photos must be reattached
following refresh. A storage failure produces a visible warning to keep the form open.
The UI does not claim success until the callable completes. No automatic submission/replay.
Existing version checks protect against overwriting another organizer's save.

## Incident response

1. Confirm scope with the failed check and Cloud Run request/startup logs. Capture timestamps,
   revision and HTTP status before changing anything. Compare homepage, OPTIONS and safe
   unauthenticated POST responses. A homepage 200 is insufficient.
2. Check deployment health, billing, runtime service identity and effective secret access.
   Do not assume a secret or registry cleanup caused an outage simply because it is nearby.
3. Deploy only a named function when a concrete correction is ready. Never use a bare
   functions deployment: this repo and the deployed legacy function set differ.
   Preserve Firebase Auth, App Check, IAM and production database rules.
4. Verify the active revision and live endpoint, then an authorized authenticated save with
   before/after private backups and public/private version read-back. Preserve real listing
   and sponsor content. Inspect reminder reconciliation. Test email only to Erik.
5. Verify the expected 30-function inventory and green full CI. Record the result and limits
   in HANDOFF.md. Tell the affected organizer to retry only after persistence is verified.

Automatic redeploy or regional failover is not enabled. The October 22 fallback region also
failed to start, so blind retries would not have provided a reliable recovery. A future
standby requires independently proven health, identical authorization, and safe duplicate
handling before it can receive real saves. Root cause follow-up remains open in TODO.md.
