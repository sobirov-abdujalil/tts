# PAYMENTS.md

Billing architecture for real money. The server and database are the only sources of truth for what a user has paid for.

## 1. Provider Strategy (D-008)

Provider availability depends on the business's legal country/entity structure — **do not assume a provider in code.** All billing code goes through the port below; exactly one adapter is active per environment.

Candidates:
- **Stripe** — full-featured gateway; requires supported country/entity.
- **Paddle / Polar / Lemon Squeezy** — merchant-of-record: they handle global sales tax/VAT; higher fee %, less granular control.
- Decision due before M6 starts; record it as a new DECISIONS entry.

```ts
interface BillingProvider {
  createCheckout(input: { userId, planCode, successUrl, cancelUrl }): Promise<{ checkoutUrl }>;
  createPortalSession(input: { userId }): Promise<{ url }>;
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): VerifiedEvent;   // throws on forgery
  mapEvent(verified: VerifiedEvent): NormalizedBillingEvent | null;
}
```

## 2. Authoritative Flow

```
Browser                    apps/api                         Provider
   │  POST /billing/checkout    │                               │
   ├──────────────────────────►│ create checkout (server-side  │
   │                           │ prices from plan config)      │
   │◄──── checkoutUrl ─────────┤                               │
   ├── user pays ─────────────────────────────────────────────►│
   │                           │◄── signed webhook ────────────┤
   │                           │ 1. verify signature (raw body)│
   │                           │ 2. INSERT payment_events      │
   │                           │    (event_id UNIQUE) →        │
   │                           │    duplicate ⇒ stop here      │
   │                           │ 3. BEGIN tx: upsert           │
   │                           │    subscription/credits/payments
   │                           │ 4. COMMIT                     │
   │ GET /me (poll)            │                               │
   ├──────────────────────────►│ plan+entitlements from DB     │
   │◄──── authoritative ───────┤                               │
```

Rules:
- The client redirect back from checkout is **never** proof of payment — UI polls `/me` until entitlement appears (with sensible timeout + "contact support" fallback).
- Prices, discounts, trial lengths come from server-side plan config only.
- Credits are consumed server-side with a reservation pattern (`reserve → generate → settle/rollback`) so crashes cannot double-spend or strand credits silently.

## 3. Event Handling Matrix

| Event | Idempotency | Action |
| --- | --- | --- |
| checkout.completed / subscription.created | event_id ledger | activate subscription row, set period bounds |
| invoice.paid (renewal) | ledger + (subscription_id, period) natural key | extend period, reset metered grants |
| invoice.payment_failed | ledger | status `past_due`, start dunning window, keep access per grace policy |
| subscription.updated (plan change) | ledger | apply proration result from provider; adjust credits delta once |
| subscription.deleted / canceled | ledger | at period end: downgrade to free; immediate on provider-immediate flag |
| refund processed | provider_payment_id UNIQUE | revoke commercial-use entitlements tied to payment, deduct granted credits if unused |
| dispute/chargeback opened | ledger | suspend paid entitlements pending review, flag account |
| payout/balance events | ignored (not entitlement-relevant) | log only |

Out-of-order delivery: events carry effective timestamps; handlers make state transitions monotonic where possible (e.g., never un-cancel an already-canceled-at-period-end sub without an explicit resume event).

## 4. Data Model (see ARCHITECTURE.md §6)

Key integrity rules:
- `payment_events.event_id` UNIQUE per provider → replay = no-op insert conflict → skip processing.
- `payments.provider_payment_id` UNIQUE.
- Money: integer minor units + currency code; never floats.
- Append-only `usage_events`; balances derived + cached in `credit_balances` reconcilable from events.

## 5. Testing Requirements (M6 gate)

- Contract tests per adapter against recorded sandbox webhook fixtures (all matrix rows).
- Replay test: same webhook twice → second is no-op.
- Forgery test: bad signature/timestamp → 400, no state change.
- Outage test: handler throws mid-processing → retry later succeeds exactly once (transactionality).
- Authorization tests: expired/canceled/refunded users lose gated API access immediately after event application.
- Client-tamper test: modified localStorage/client state grants nothing.

## 6. Operational Notes

- Webhook endpoint returns 2xx only after durable handling (or schedules reliable retry via queue); otherwise non-2xx so provider retries.
- Alerting: webhook verification failures, processing errors, dunning spikes, credit balance anomalies.
- Manual ops: admin CLI/route (audited) to grant/revoke entitlements with reason field.
