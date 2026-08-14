CREATE TABLE `workflow_node_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`iteration` integer DEFAULT 0 NOT NULL,
	`output` text,
	`error` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_node_runs_run_idx` ON `workflow_node_runs` (`run_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'RUNNING' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`error` text,
	`steps` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_workflow_idx` ON `workflow_runs` (`workflow_id`);--> statement-breakpoint
CREATE INDEX `workflow_runs_started_idx` ON `workflow_runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `workflow_edges` ADD `label` text;--> statement-breakpoint
ALTER TABLE `workflows` ADD `trigger` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflows` ADD `event_type` text;--> statement-breakpoint
ALTER TABLE `workflows` ADD `variables` text DEFAULT '{}' NOT NULL;