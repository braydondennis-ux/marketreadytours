# Tour cancellation and refund follow-up

## Behavior

Cancel Tour replaces destructive deletion. The confirmation loads current paid sponsors,
recorded amounts and payment references. A paid tour requires explicit acknowledgment that
cancellation does not issue refunds. The server checks both tour version and payment preview
before committing; new payments require a fresh review.

Cancellation retains the private tour, ratings and payment history, removes its public
projection, stops pending tour reminders and blocks new checkouts, edits, approvals and
ratings. Previously opened processor checkout pages cannot be revoked by this app; late
Clover and Square payment events retain the receipt, create a pending resolution task and
queue an additional notice to the original canceling organizer. Webhook processing and its
receipt commit together so failed processing remains retryable.

One cancellation email is queued to the acting admin's Firebase Auth email, never a
client-selected address. The existing durable outbox retries delivery and surfaces failures.
A message already handed to a provider at cancellation time cannot be recalled.

Admins reopen **Cancelled tours · Refund follow-up**, use the processor lookup and saved
reference, and record a completed refund reference or other agreed resolution. This is a staff
attestation, not processor verification. No money is moved. No sponsor or agent email is sent
by this workflow. Review existing disputes before taking any financial action.

## Payment reference limitations

Older Clover receipts may contain only a checkout-session reference. The UI shows the actual
saved reference with Clover's Orders lookup; it does not invent a direct transaction link.
New approved events capture their payment ID. Recorded sponsorship amounts may exclude
processor surcharges. Manually marked payments and partial Square payments require amount
verification. All matching paid receipts are included, even if a display flag was changed.

## Implementation and operational limits

Existing deleteTour supports preview, cancel and resolve actions; no new Cloud Function.
Cancellation state and tasks live on the admin-only private tour. Multi-location lifecycle,
payment and projection commits serialize through an RTDB root transaction. This prioritizes
consistency for the current small database; monitor root size and contention as usage grows.
No rules deployment. saveTour retains 512MiB and maxInstances 20.

The tall dashboard header now scrolls normally on phones so it cannot cover tour controls.
Cancellation dialogs scroll within the viewport and use explicit payment acknowledgment.

## Verification

Unit/static checks and isolated Firebase workflow and iPhone/Chrome browser tests cover
cancellation with and without paid sponsors, stale previews, duplicate cancellation, retained
payment records, blocked cancelled-tour checkouts/edits, refund notes, late Clover and Square
payments and notification recipients. 167 unit tests, 13 static checks, the Firebase workflow suite and all 33 browser cases passed.
All test delivery is mocked; no live tour, real payment or agent inbox is used.
Release results will be recorded after deployment.
