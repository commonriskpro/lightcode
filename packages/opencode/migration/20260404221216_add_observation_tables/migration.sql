CREATE TABLE `session_observation_buffer` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`observations` text NOT NULL,
	`message_tokens` integer NOT NULL,
	`observation_tokens` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_session_observation_buffer_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_observation` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`observations` text,
	`reflections` text,
	`last_observed_at` integer,
	`generation_count` integer NOT NULL,
	`observation_tokens` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_session_observation_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `obs_buffer_session_idx` ON `session_observation_buffer` (`session_id`);--> statement-breakpoint
CREATE INDEX `observation_session_idx` ON `session_observation` (`session_id`);