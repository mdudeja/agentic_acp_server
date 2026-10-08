CREATE TABLE `session_summaries` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`session_id` text NOT NULL,
	`file_path` text NOT NULL,
	`format` text DEFAULT 'markdown' NOT NULL,
	CONSTRAINT `fk_session_summaries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_session_summary_session_id` ON `session_summaries` (`session_id`);