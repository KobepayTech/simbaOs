CREATE UNIQUE INDEX `branch_region_district` ON `branches` (`region`,`district`);--> statement-breakpoint
CREATE INDEX `orders_member_created` ON `orders` (`member_id`,`created`);--> statement-breakpoint
CREATE INDEX `points_member` ON `points` (`member_id`);