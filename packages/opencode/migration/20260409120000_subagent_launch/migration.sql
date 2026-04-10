CREATE TABLE IF NOT EXISTS `subagent_launch` (
	`id` text PRIMARY KEY,
	`parent_session_id` text NOT NULL,
	`parent_message_id` text NOT NULL,
	`child_session_id` text NOT NULL UNIQUE,
	`agent` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`description` text NOT NULL,
	`prompt` text NOT NULL,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`snapshot_json` text,
	`error` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subagent_launch_child` ON `subagent_launch` (`child_session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subagent_launch_state` ON `subagent_launch` (`state`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subagent_launch_parent` ON `subagent_launch` (`parent_session_id`);
