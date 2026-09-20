# SimbaOS club administration

Open `/admin`. This is a separate administrator application with its own navigation, login screen, and management API (`/api/admin`), sharing the fan application's database. It is not a disconnected copy of the fan system.

## First setup

1. Sign in with an approved administrator. The private review deployment preserves the existing owner's access. Self-hosted deployments use verified phone identities listed in `ADMIN_PHONES`; never trust Sites identity headers outside a protected Sites gateway.
2. In **Club information**, enter support details, office address, club description, website/social links, membership terms and privacy text.
3. In **Membership pricing**, publish approved TZS fees and membership duration. Standard < First 100 < Prestige (101–999) < repeated digits. Existing orders retain the original quoted price.
4. In **Payment methods**, add the club's real bank, mobile-money or cash collection details. Enable only approved methods. Active instructions appear in the fan app.
5. Add branches and assign staff access. Administrators manage all data; leaders and scanners continue using their scoped fan-app tools. Deployment-configured administrators retain recovery access, independently of database roles.

## Member and payment desk

- Search members by name, phone, permanent ID, or assigned number; filter by region or active status. Joining rank and fan identity are permanent.
- Staff may create a member profile. This does **not** verify the phone. Phone verification is completed through the normal OTP flow; unverified members cannot vote even if staff record a payment.
- Open a member and choose **Record payment**. The server quotes the published fee and temporarily reserves the number. A currently active member renews their existing number.
- Confirm money in the actual club bank/mobile-money account or cash ledger. Enter the real transaction/receipt reference, amount, method, date and notes; explicitly confirm receipt.
- Recording does not initiate a transfer. It records already-received money, uses the existing atomic membership activation, awards points once and schedules renewal reminders.
- References cannot be reused for another order. Retries of the identical submission do not duplicate activation or points. Payment records retain the method name and staff actor at recording time.
- An expired reservation or ownership conflict enters **review**, without activating membership or taking another fan's number. Complete any refund outside SimbaOS, then **Record completed refund** with its transaction reference. This records evidence only; it never sends a refund.
- Existing paid receipts cannot be edited. Refund recording in this release covers unapplied review payments, not reversing an already-active membership.
- Member and payment pages use server pagination and filters. **Export page** downloads the current page only (25 rows), with CSV formula escaping.

## Content and operations

- Publish/draft club news; manage announcements, district branches, upcoming events and benefits. Published content appears in the fan application.
- Events cannot be edited after their start. Claimed benefits preserve their points cost and expiry; descriptions can be updated or availability disabled.
- Open national/regional/district ballots with candidate biographies. Eligibility is frozen at opening. Candidate edits are unavailable after opening; early closure requires a recorded reason. Results appear after closure without member-choice linkage.
- Staff assignment is audited. An administrator cannot change their own database role through the new admin API.
- Review queued/accepted/unknown message states under **Reminders** and actor/time records under **Activity log**. Service status indicates credentials configured, not a successful live integration test.

## Remaining external configuration

Automatic mobile-money collection, OTP and outbound SMS still require the credentials and adapter in `INTEGRATIONS.md`. Adding payment methods does not connect providers. The reminder worker must also be scheduled. The Site remains private for review; no demo members, fees or payment accounts are inserted into production.
