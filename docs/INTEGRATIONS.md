# Production connections

This app is a mobile-first web application/PWA, not a native Android or iOS binary. Fans can install it through their browser. No offline payments, votes or private-data caching are allowed.

## Identity and administrators

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`: real Twilio Verify SMS codes. No test-code login exists in production.
- `TWILIO_MESSAGING_SERVICE_SID`: outbound renewal/waitlist SMS.
- `ADMIN_PHONES`: comma-separated verified administrator phone numbers.
- On a Sites deployment only, `TRUST_SITES_AUTH=true` enables its gateway authentication; `ADMIN_SITES_EMAILS` allows named, gateway-verified club administrators. NEVER enable header trust on an unprotected self-hosted server.
- Phone sessions use random opaque tokens, server-side hashes, expiry and HttpOnly Secure SameSite cookies. OTP attempts and sends are limited per phone and trusted Cloudflare IP.
- Account recovery uses a fresh OTP on the same phone. Lost-number recovery requires a future audited club identity review; no insecure bypass is provided.

## Payment adapter contract

No payment provider was selected or connected. A club-owned HTTPS adapter must implement this contract for the chosen provider. Do not point it at an arbitrary provider endpoint.

- `PAYMENT_GATEWAY_URL`: HTTPS collection endpoint.
- `PAYMENT_GATEWAY_TOKEN`: bearer credential to that endpoint.
- `PAYMENT_WEBHOOK_SECRET`: independent random HMAC secret.
- The app sends `POST` JSON with `orderId`, integer TZS `amount`, `currency`, `phone`, `callbackUrl`, and `description`; `Idempotency-Key` is the order ID.
- Return JSON `{ "reference": "provider-reference" }` on successful initiation. The adapter MUST reuse the same provider collection for repeated idempotency keys.
- After provider-confirmed settlement, post `{ "eventId": "unique-event", "orderId": "uuid", "amount": 123, "currency": "TZS", "receipt": "unique-provider-receipt", "status": "paid" }` to `/api/payment-webhook`.
- `x-payment-timestamp`: Unix seconds; `x-payment-signature`: hex HMAC-SHA256(secret, timestamp + "." + exact raw JSON body). Replay window is five minutes. Retry with a fresh signature timestamp but the same event/body identifiers.
- The adapter must validate upstream provider signatures and authoritative settlement status before sending this normalized event. Never accept a screenshot or browser success callback as payment confirmation.
- Amount/currency must match the server-side order; a unique receipt may settle only one order. Expired reservations or conflicting number ownership put a paid order in `review`. Admins must reconcile/refund through the provider; there is no fabricated refund button.
- Final prices and membership duration must be published by a club administrator before checkout works. Current defaults leave every price unconfigured.

## Scheduler and SMS

- Set a random `CRON_SECRET` on the app and scheduler.
- Deploy `ops/scheduler.ts` with the sample Wrangler file after setting the app origin and secret. It calls `/api/jobs` every 15 minutes. Do not deploy until SMS credentials and message costs are approved.
- SMS state `accepted` means accepted by the messaging provider, not delivered. Ambiguous send failures are `unknown` and must be reconciled before manual retry to prevent duplicate messages.
- One-calendar-month reminder is always scheduled; 7-day and 1-day reminders are configurable.

## Public launch

The current review Site stays private. Configure public access and the final club domain only after phone/payment/SMS connections and club policies are approved. The onboarding and card QR codes derive their host from the current origin.

## Voting limits

Each ballot freezes eligible paid, phone-verified members at opening. Each member may vote once. Current paid status is also checked when casting. Candidate choices are stored separately from participation with unrelated IDs and no timestamp. Club UI exposes only participation and aggregate results after close. This is application-level ballot privacy, not end-to-end cryptographic election secrecy against a database/operator adversary.

## References

https://www.twilio.com/docs/verify/api/verification
https://www.twilio.com/docs/verify/api/verification-check
https://www.twilio.com/docs/messaging/api/message-resource
https://developers.cloudflare.com/d1/worker-api/d1-database/
