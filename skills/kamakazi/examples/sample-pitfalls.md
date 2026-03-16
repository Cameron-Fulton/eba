# Known Pitfalls: Stripe API

**Generated:** 2026-02-17
**Sources:** Web research, probe app testing, official documentation

## From Documentation

### Webhook signature verification requires raw body

- **Symptom:** `stripe.webhooks.constructEvent()` throws "No signatures found matching the expected signature"
- **Root Cause:** Express/Next.js parses the body as JSON before Stripe can verify the raw signature
- **Detection:** Webhook endpoint returns 400 on every Stripe event
- **Fix:** Use `bodyParser: false` in Next.js route config or `express.raw()` middleware for the webhook route

### Test vs Live mode key confusion

- **Symptom:** API calls succeed locally but return "No such customer" or empty results in production
- **Root Cause:** Using test-mode keys (`sk_test_`) against live-mode resources or vice versa
- **Detection:** Check the key prefix — `sk_test_` vs `sk_live_`
- **Fix:** Use environment-specific keys; never mix test/live in the same env file

## From Web Research

### stripe-node v14+ requires explicit API version

- **Symptom:** `StripeInvalidRequestError: Invalid API version` on first call
- **Root Cause:** SDK v14 changed to require explicit API version in constructor
- **Detection:** Error on any API call immediately after init
- **Fix:** Pass `apiVersion: '2024-12-18.acacia'` (or current) to the Stripe constructor
- **Source:** https://github.com/stripe/stripe-node/issues/1234

### Pagination returns max 100 items by default

- **Symptom:** Only 100 invoices returned when there should be more
- **Root Cause:** Default `limit` is 100; results are paginated via `starting_after` cursor
- **Detection:** Result `has_more` field is `true` but code doesn't paginate
- **Fix:** Use `stripe.invoices.list({ limit: 100 })` in a loop checking `has_more`, passing `starting_after: lastItem.id`
- **Source:** https://docs.stripe.com/api/pagination

## From Probe App Testing

### Missing `STRIPE_SECRET_KEY` gives unhelpful error

- **Symptom:** `TypeError: Cannot read properties of undefined (reading 'apiKey')` at init
- **Root Cause:** Environment variable not set; Stripe constructor receives `undefined`
- **Fix:** Added explicit env var check with clear error message before initializing Stripe
