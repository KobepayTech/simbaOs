CREATE TABLE `club_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `club_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `manual_payments` (
	`order_id` text PRIMARY KEY NOT NULL,
	`method_id` text NOT NULL,
	`method_name` text NOT NULL,
	`received_at` text NOT NULL,
	`note` text NOT NULL,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`account_name` text NOT NULL,
	`account_number` text NOT NULL,
	`instructions` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refund_records` (
	`order_id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`note` text NOT NULL,
	`actor` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_records_reference_unique` ON `refund_records` (`reference`);