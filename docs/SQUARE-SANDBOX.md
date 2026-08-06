# Square Sandbox setup for the demo

This integration is intentionally restricted to the isolated `marketready-tours-dev` Firebase
project and Square Sandbox. It never accepts a production Square token or creates a real charge.

## What the app does

1. An admin approves a pending sponsor.
2. `createSponsorInvoice` derives the price from the stored plan:
   - full: $199.00
   - half: $99.50
   - quarter: $49.75
3. The Function creates a Square Sandbox customer, order, and invoice, then publishes the invoice.
4. The admin receives the Square-hosted Sandbox payment URL.
5. The sponsor stays absent from `mrt_tours_public` until a signature-verified
   `invoice.payment_made` event reports the invoice status as `PAID`.
6. `invoice.refunded` sets the sponsor to refunded and removes them from the public projection.

Local emulators keep using a mock invoice and never call Square.

## Required Firebase Functions secrets

Sign in to Firebase first, then set these on the dev project. The CLI prompts for each value;
do not put secret values in this repository.

```sh
firebase functions:secrets:set MRT_SQUARE_ACCESS_TOKEN --project marketready-tours-dev
firebase functions:secrets:set MRT_SQUARE_LOCATION_ID --project marketready-tours-dev
firebase functions:secrets:set MRT_SQUARE_WEBHOOK_SECRET --project marketready-tours-dev
firebase functions:secrets:set MRT_SQUARE_WEBHOOK_URL --project marketready-tours-dev
```

- `MRT_SQUARE_ACCESS_TOKEN`: Square Developer Console → Sandbox → Credentials.
- `MRT_SQUARE_LOCATION_ID`: Square Developer Console → Sandbox → Locations.
- `MRT_SQUARE_WEBHOOK_SECRET`: the signature key from the Sandbox webhook subscription.
- `MRT_SQUARE_WEBHOOK_URL`: exactly
  `https://us-central1-marketready-tours-dev.cloudfunctions.net/squareWebhook`.

## Square Sandbox webhook

In the Square Developer Console, create a Sandbox webhook subscription using the exact URL above
and subscribe to:

- `invoice.payment_made`
- `invoice.refunded`

The URL used to validate the signature must match byte-for-byte, including scheme, hostname, path,
and absence of an extra trailing slash.

## Deploy and test

Deploy only the isolated dev Functions:

```sh
firebase deploy --only functions --project marketready-tours-dev
```

Then create a fresh sponsor request on the demo, approve it, and choose **Create Test Invoice**.
Open the returned Sandbox payment page and use a Square Sandbox test card. Never enter a real card
on a `squareupsandbox.com` page.

After payment, verify the sponsor appears publicly. After a Sandbox refund, verify the sponsor is
removed again.
