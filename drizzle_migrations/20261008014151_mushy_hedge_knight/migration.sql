PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_summaries` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`session_id` text NOT NULL CONSTRAINT `idx_session_id` UNIQUE,
	`file_path` text NOT NULL,
	`format` text DEFAULT 'markdown' NOT NULL,
	CONSTRAINT `fk_session_summaries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_session_summaries`(`id`, `created_at`, `updated_at`, `session_id`, `file_path`, `format`) SELECT `id`, `created_at`, `updated_at`, `session_id`, `file_path`, `format` FROM `session_summaries`;--> statement-breakpoint
DROP TABLE `session_summaries`;--> statement-breakpoint
ALTER TABLE `__new_session_summaries` RENAME TO `session_summaries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_session_summary_session_id` ON `session_summaries` (`session_id`);