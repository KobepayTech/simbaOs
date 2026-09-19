CREATE TABLE `ballots` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`region` text,
	`options` text NOT NULL,
	`opens` text NOT NULL,
	`closes` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eligibility` (
	`id` text PRIMARY KEY NOT NULL,
	`ballot_id` text NOT NULL,
	`member_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_eligible` ON `eligibility` (`ballot_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`number` integer PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires` text NOT NULL,
	`paid_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_member_id_unique` ON `holdings` (`member_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`region` text NOT NULL,
	`requested_number` integer NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_id_unique` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expiry` text NOT NULL,
	`due` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`ballot_id` text NOT NULL,
	`member_id` text NOT NULL,
	`choice` integer NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_vote` ON `votes` (`ballot_id`,`member_id`);