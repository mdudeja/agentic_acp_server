CREATE TABLE `agents` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`provider_name` text NOT NULL,
	`provider_title` text NOT NULL,
	`provider_command` text NOT NULL,
	`provider_args` text NOT NULL,
	`permissions_rule` text DEFAULT 'ask' NOT NULL,
	`cwd` text NOT NULL,
	`env` text,
	`default_model_id` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`name` text,
	`acp_session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`is_archived` integer DEFAULT false,
	CONSTRAINT `fk_sessions_agent_id_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_agent_provider_cwd` ON `agents` (`provider_name`,`cwd`);--> statement-breakpoint
CREATE INDEX `idx_agent_created_at` ON `agents` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_updated_at` ON `agents` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_session_agent_id` ON `sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_session_created_at` ON `sessions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_session_updated_at` ON `sessions` (`updated_at`);