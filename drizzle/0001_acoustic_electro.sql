CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`branch_id` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`event_id` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_checkin` ON `attendance` (`member_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ballot_details` (
	`ballot_id` text PRIMARY KEY NOT NULL,
	`district` text,
	`candidates` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `benefits` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`partner` text NOT NULL,
	`cost` integer DEFAULT 0 NOT NULL,
	`expires` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text NOT NULL,
	`district` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`benefit_id` text NOT NULL,
	`created` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_benefit_claim` ON `claims` (`member_id`,`benefit_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`venue` text NOT NULL,
	`starts` text NOT NULL,
	`ends` text NOT NULL,
	`branch_id` text,
	`points` integer DEFAULT 10 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`number` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`expires` text NOT NULL,
	`status` text NOT NULL,
	`created` text NOT NULL,
	`provider_ref` text,
	`receipt` text,
	`paid_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_provider_ref_unique` ON `orders` (`provider_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_receipt_unique` ON `orders` (`receipt`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claim_until` text,
	`provider_id` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participation` (
	`id` text PRIMARY KEY NOT NULL,
	`ballot_id` text NOT NULL,
	`member_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_secret_vote` ON `participation` (`ballot_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`digest` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `points` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`ordinal` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` text NOT NULL,
	`district` text DEFAULT '' NOT NULL,
	`locale` text DEFAULT 'sw' NOT NULL,
	`verified_phone` text,
	`referrer` text,
	`card_token` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_member_id_unique` ON `profiles` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_verified_phone_unique` ON `profiles` (`verified_phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_card_token_unique` ON `profiles` (`card_token`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`number` integer PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`order_id` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_member_id_unique` ON `reservations` (`member_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`principal` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`branch_id` text
);
--> statement-breakpoint
CREATE TABLE `sealed_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`ballot_id` text NOT NULL,
	`choice` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`principal` text NOT NULL,
	`phone` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`number` integer NOT NULL,
	`created` text NOT NULL,
	`notified` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_member_number` ON `waitlist` (`member_id`,`number`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`member_id` text PRIMARY KEY NOT NULL,
	`points` integer DEFAULT 0 NOT NULL
);
