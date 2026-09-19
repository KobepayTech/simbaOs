# Simba membership source audit — 19 September 2026

Source: https://simbasc.co.tz/

Public content observed: club name, crest, red/white identity, Wekundu wa Msimbazi naming, honours, news, match listings and Simba TV links. The homepage lists 22 league titles, 6 CECAFA titles, 3 Nyerere Cups, 4 FAT Cups, 2 Dar es Salaam leagues, 5 Tusker Cups, 10 Community Shields, 3 Mapinduzi Cups and runner-up finishes in CAF Cup and Confederation Cup. Counts are source claims, not independently audited.

https://simbasc.co.tz/news lists 6,877 stories, with a load-more interaction. This project does NOT claim to have crawled the entire archive. It contains short original summaries and source links rather than republishing articles.

https://simbasc.co.tz/news/tumeibuka-kidedea-katika-dabi-ya-mzizima reports the 2–0 Azam derby result on 16 September 2026.

https://simbasc.co.tz/matches lists 24 upcoming matches and 180 results. The homepage result strip differs in recency from the latest news; the platform labels fixture data as a dated source snapshot. It does not promise a live feed.

Crest: https://simbasc.co.tz/wp-content/uploads/2021/03/cropped-Simba_Sports_Club-1.png
The crest loaded successfully in browser QA.

Membership, ticket and several club/team/footer menu labels do not expose substantive linked pages in the extracted page. No private fan records, official fee schedule, membership API, leadership directory or verified complete current squad dataset was obtained. robots.txt and sitemap.xml were inaccessible to the web retrieval tool. Direct shell retrieval timed out. A full archival scrape remains incomplete.

Regions: https://en.wikipedia.org/wiki/Regions_of_Tanzania and https://en.wikipedia.org/wiki/ISO_3166-2%3ATZ. 31 regional categories, with Swahili names for the Zanzibar regions. No invented member totals or branches.

# Launch dependencies
- Club-authorized fee and renewal schedule, including repeated-digit override and 101–999 above 1–100 as requested.
- Payment provider contract/credentials and a verified, idempotent payment callback before assigning real numbers.
- Phone OTP and recovery provider; current private review uses Sites account authentication.
- SMS provider and production reminder scheduler; one calendar month before expiry, clamped at month-end.
- Club administrator identities and actual ballots. No fabricated elections or member data.
- Public fan access and intended kobeapptz.com domain configuration. Current Site remains owner-private.

# Implemented foundation
QR to /join; responsive onboarding; required region and Tanzanian phone validation; permanent IDs persisted in D1; pending number preferences; server-side number-category validation and availability; active-only ballot API and immutable member-based duplicate-vote constraint; regional catalog; membership view; source-linked club content. Holdings expiry is evaluated on every availability and membership read, so expired holdings do not remain active. Number reassignment and reminder queuing functions are provided for a trusted future payment integration. No client can activate membership or choose a payment amount.
