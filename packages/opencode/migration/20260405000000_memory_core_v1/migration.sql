CREATE TABLE IF NOT EXISTS `memory_working` (
	`id` text PRIMARY KEY,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`format` text NOT NULL DEFAULT 'markdown',
	`version` integer NOT NULL DEFAULT 1,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_wm_scope_key` ON `memory_working` (`scope_type`, `scope_id`, `key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wm_scope` ON `memory_working` (`scope_type`, `scope_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wm_updated` ON `memory_working` (`time_updated`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_artifacts` (
	`id` text PRIMARY KEY,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`topic_key` text,
	`normalized_hash` text,
	`revision_count` integer NOT NULL DEFAULT 1,
	`duplicate_count` integer NOT NULL DEFAULT 1,
	`last_seen_at` integer,
	`deleted_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_art_scope` ON `memory_artifacts` (`scope_type`, `scope_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_art_topic` ON `memory_artifacts` (`topic_key`, `scope_type`, `scope_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_art_type` ON `memory_artifacts` (`type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_art_hash` ON `memory_artifacts` (`normalized_hash`, `scope_type`, `scope_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_art_deleted` ON `memory_artifacts` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_art_created` ON `memory_artifacts` (`time_created`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `memory_artifacts_fts` USING fts5(title, content, topic_key, type, scope_type, scope_id, content='memory_artifacts', content_rowid='rowid');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `art_fts_insert` AFTER INSERT ON `memory_artifacts` BEGIN INSERT INTO memory_artifacts_fts(rowid, title, content, topic_key, type, scope_type, scope_id) VALUES (new.rowid, new.title, new.content, new.topic_key, new.type, new.scope_type, new.scope_id); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `art_fts_delete` AFTER DELETE ON `memory_artifacts` BEGIN INSERT INTO memory_artifacts_fts(memory_artifacts_fts, rowid, title, content, topic_key, type, scope_type, scope_id) VALUES ('delete', old.rowid, old.title, old.content, old.topic_key, old.type, old.scope_type, old.scope_id); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `art_fts_update` AFTER UPDATE ON `memory_artifacts` BEGIN INSERT INTO memory_artifacts_fts(memory_artifacts_fts, rowid, title, content, topic_key, type, scope_type, scope_id) VALUES ('delete', old.rowid, old.title, old.content, old.topic_key, old.type, old.scope_type, old.scope_id); INSERT INTO memory_artifacts_fts(rowid, title, content, topic_key, type, scope_type, scope_id) VALUES (new.rowid, new.title, new.content, new.topic_key, new.type, new.scope_type, new.scope_id); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_agent_handoffs` (
	`id` text PRIMARY KEY,
	`parent_session_id` text NOT NULL,
	`child_session_id` text NOT NULL UNIQUE,
	`context` text NOT NULL,
	`working_memory_snap` text,
	`observation_snap` text,
	`metadata` text,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_handoff_child` ON `memory_agent_handoffs` (`child_session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_handoff_parent` ON `memory_agent_handoffs` (`parent_session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_fork_contexts` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL UNIQUE,
	`parent_session_id` text NOT NULL,
	`context` text NOT NULL,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fork_session` ON `memory_fork_contexts` (`session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_links` (
	`id` text PRIMARY KEY,
	`from_artifact_id` text NOT NULL,
	`to_artifact_id` text NOT NULL,
	`relation` text NOT NULL,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_link_from` ON `memory_links` (`from_artifact_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_link_to` ON `memory_links` (`to_artifact_id`);
