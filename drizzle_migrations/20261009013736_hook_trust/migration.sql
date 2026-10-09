CREATE TABLE `hook_trust` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`path` text NOT NULL CONSTRAINT `idx_hook_trust_path` UNIQUE,
	`sha256` text NOT NULL,
	`trusted` integer NOT NULL
);
