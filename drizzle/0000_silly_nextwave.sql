CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`filename` text,
	`content_type` text,
	`size_bytes` integer DEFAULT 0,
	`storage_key` text NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_email` ON `attachments` (`email_id`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_domain_unique` ON `domains` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_domains_active` ON `domains` (`is_active`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`recipient_address` text DEFAULT '' NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`subject` text DEFAULT '(no subject)',
	`received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`size_bytes` integer DEFAULT 0,
	`has_attachments` integer DEFAULT false NOT NULL,
	`body_key` text,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_emails_inbox_received_id` ON `emails` (`inbox_id`,`received_at`,`id`);--> statement-breakpoint
CREATE TABLE `inboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`local_part` text NOT NULL,
	`domain` text NOT NULL,
	`full_address` text NOT NULL,
	`is_permanent` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inboxes_full_address_unique` ON `inboxes` (`full_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inboxes_local_domain` ON `inboxes` (`local_part`,`domain`);--> statement-breakpoint
CREATE INDEX `idx_inboxes_domain` ON `inboxes` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_inboxes_permanent_expires` ON `inboxes` (`is_permanent`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_inboxes_permanent_created` ON `inboxes` (`is_permanent`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_inboxes_permanent_domain_local` ON `inboxes` (`is_permanent`,`domain`,`local_part`);