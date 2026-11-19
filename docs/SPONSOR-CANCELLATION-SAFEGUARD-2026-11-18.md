# Sponsor cancellation safeguard, November 18, 2026

## Immediate protection

- saveTour rejects removal of an existing paid or partially paid sponsor, based on server-side state. Client payment flags cannot bypass the check.
- deleteTour rejects tours with paid or partially paid sponsors.
- Mark Unpaid requires a 20–2000 character resolution note and acknowledgement that it does not issue a refund.
- The prior sponsor record, tour identifiers, note, timestamp and acting admin are written atomically with the status change into private mrt_sponsor_payment_reviews. This record survives sponsor/tour deletion. Default deny rules prevent client reads/writes; no rules deployment is required.
- The browser explains the protection and asks for the resolution note before changing payment status.
- Transaction validation errors abort writes and are returned as actionable callable errors, rather than escaping the Firebase callback and crashing the request.

The note is a staff attestation, not verification of a processor refund. Existing payment status remains authoritative. These guards do not detect off-platform cancellations, rescheduling, payments arriving concurrently with deletion, or historical payments that were already marked unpaid. This first patch is not a full cancellation or chargeback-management system.

## Next workflow

Build a dedicated Cancel Tour action instead of encouraging deletion. Preserve a cancelled tour and its payment records; stop new checkouts and future tour reminders; create one payment-resolution task per paid sponsor. Notify sponsors about the cancellation with an agreed refund/transfer process, track delivery failures and alert the organizer while tasks remain open. Record actual processor refund references separately from paid/unpaid display state. Transfers require sponsor agreement and a specified destination tour. Integrate webhook/checkout concurrency protection into the same lifecycle before allowing automated cancellation.

No automatic refunds or credits are authorized by this patch. An existing dispute requires separate review before any financial action. Matching the charge, selecting a response, and submitting dispute evidence remain outstanding.

## Verification

162 unit tests and 13 build/static checks passed. Isolated Firebase workflows verified paid deletion/removal rejection, unchanged saved data on rejection, missing-review rejection and valid reviewed status correction. All 30 isolated browser tests passed across small iPhone, large iPhone and Chrome, including rejection of paid sponsor removal without losing the saved sponsor. Deployment results will be recorded below when complete. No production emails or financial transactions were used in testing.
