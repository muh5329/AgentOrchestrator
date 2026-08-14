CREATE TABLE `agent_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_agent_id` text NOT NULL,
	`to_agent_id` text NOT NULL,
	`kind` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_rel_project_idx` ON `agent_relationships` (`project_id`);--> statement-breakpoint
CREATE INDEX `agent_rel_from_idx` ON `agent_relationships` (`from_agent_id`);--> statement-breakpoint
CREATE INDEX `agent_rel_to_idx` ON `agent_relationships` (`to_agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_rel_unique` ON `agent_relationships` (`from_agent_id`,`to_agent_id`,`kind`);--> statement-breakpoint
CREATE TABLE `agent_toolkits` (
	`agent_id` text NOT NULL,
	`toolkit_id` text NOT NULL,
	PRIMARY KEY(`agent_id`, `toolkit_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`toolkit_id`) REFERENCES `toolkits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_agent_id` text,
	`name` text NOT NULL,
	`role` text DEFAULT 'worker' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'claude-code' NOT NULL,
	`model` text DEFAULT 'sonnet' NOT NULL,
	`temperature` integer DEFAULT 70 NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`max_children` integer,
	`max_depth` integer,
	`is_built_in` integer DEFAULT false NOT NULL,
	`created_by_agent_id` text,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_active_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_project_idx` ON `agents` (`project_id`);--> statement-breakpoint
CREATE INDEX `agents_parent_idx` ON `agents` (`parent_agent_id`);--> statement-breakpoint
CREATE INDEX `agents_status_idx` ON `agents` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_project_name_unique` ON `agents` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text,
	`task_id` text,
	`execution_id` text,
	`action` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`resolution` text,
	`decided_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approvals_project_idx` ON `approvals` (`project_id`);--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`status`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`execution_id` text,
	`agent_id` text,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`path` text,
	`content` text,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_project_idx` ON `artifacts` (`project_id`);--> statement-breakpoint
CREATE INDEX `artifacts_task_idx` ON `artifacts` (`task_id`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`max_cost_usd_micros` integer,
	`max_tokens` integer,
	`max_runtime_ms` integer,
	`max_tool_calls` integer,
	`spent_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`spent_tokens` integer DEFAULT 0 NOT NULL,
	`action` text DEFAULT 'pause' NOT NULL,
	`period` text DEFAULT 'total' NOT NULL,
	`period_start` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budgets_scope_idx` ON `budgets` (`scope`,`scope_id`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`execution_id` text,
	`judge_agent_id` text,
	`rubric_id` text,
	`score` integer DEFAULT 0 NOT NULL,
	`decision` text NOT NULL,
	`criteria` text DEFAULT '[]' NOT NULL,
	`checklist` text DEFAULT '[]' NOT NULL,
	`issues` text DEFAULT '[]' NOT NULL,
	`required_changes` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evals_project_idx` ON `evaluations` (`project_id`);--> statement-breakpoint
CREATE INDEX `evals_task_idx` ON `evaluations` (`task_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`agent_id` text,
	`task_id` text,
	`execution_id` text,
	`type` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_project_idx` ON `events` (`project_id`);--> statement-breakpoint
CREATE INDEX `events_agent_idx` ON `events` (`agent_id`);--> statement-breakpoint
CREATE INDEX `events_task_idx` ON `events` (`task_id`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `events_created_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE TABLE `task_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`parent_execution_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`iterations` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`error` text,
	`transcript` text DEFAULT '[]' NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	`heartbeat_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exec_project_idx` ON `task_executions` (`project_id`);--> statement-breakpoint
CREATE INDEX `exec_task_idx` ON `task_executions` (`task_id`);--> statement-breakpoint
CREATE INDEX `exec_agent_idx` ON `task_executions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `exec_status_idx` ON `task_executions` (`status`);--> statement-breakpoint
CREATE INDEX `exec_started_idx` ON `task_executions` (`started_at`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text,
	`task_id` text,
	`scope` text DEFAULT 'project' NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`importance` integer DEFAULT 50 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memories_project_idx` ON `memories` (`project_id`);--> statement-breakpoint
CREATE INDEX `memories_agent_idx` ON `memories` (`agent_id`);--> statement-breakpoint
CREATE INDEX `memories_scope_idx` ON `memories` (`scope`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_agent_id` text,
	`to_agent_id` text,
	`task_id` text,
	`type` text DEFAULT 'MESSAGE' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`content` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_project_idx` ON `messages` (`project_id`);--> statement-breakpoint
CREATE INDEX `messages_to_idx` ON `messages` (`to_agent_id`);--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `model_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`alias` text DEFAULT '' NOT NULL,
	`tier` text DEFAULT 'standard' NOT NULL,
	`context_window` integer DEFAULT 200000 NOT NULL,
	`input_cost_per_mtok_micros` integer DEFAULT 0 NOT NULL,
	`output_cost_per_mtok_micros` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `model_configs_provider_idx` ON `model_configs` (`provider_id`);--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text DEFAULT 'file' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_files_project_idx` ON `project_files` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`mission` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`root_path` text,
	`instructions` text DEFAULT '' NOT NULL,
	`template` text,
	`settings` text NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `projects_created_idx` ON `projects` (`created_at`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`adapter` text NOT NULL,
	`base_url` text,
	`binary_path` text,
	`enabled` integer DEFAULT true NOT NULL,
	`credential_ref` text,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rubrics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`dimensions` text NOT NULL,
	`pass_threshold` integer DEFAULT 80 NOT NULL,
	`escalate_threshold` integer DEFAULT 30 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text,
	`name` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`cron` text,
	`interval_ms` integer,
	`run_at` integer,
	`event_type` text,
	`depends_on_task_id` text,
	`timezone` text DEFAULT 'local' NOT NULL,
	`catchup_policy` text DEFAULT 'run_once' NOT NULL,
	`task_template` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`run_count` integer DEFAULT 0 NOT NULL,
	`max_runs` integer,
	`created_by_agent_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedules_project_idx` ON `schedules` (`project_id`);--> statement-breakpoint
CREATE INDEX `schedules_next_run_idx` ON `schedules` (`next_run_at`);--> statement-breakpoint
CREATE INDEX `schedules_event_idx` ON `schedules` (`event_type`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`kind` text DEFAULT 'completion' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_deps_task_idx` ON `task_dependencies` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_deps_dep_idx` ON `task_dependencies` (`depends_on_task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_deps_unique` ON `task_dependencies` (`task_id`,`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text,
	`parent_task_id` text,
	`created_by_agent_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'BACKLOG' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`deadline` integer,
	`retry_policy` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`requires_judge` integer DEFAULT true NOT NULL,
	`judge_agent_id` text,
	`revision_of_task_id` text,
	`revision_count` integer DEFAULT 0 NOT NULL,
	`score` integer,
	`result` text,
	`error` text,
	`blocked_reason` text,
	`schedule_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_agent_idx` ON `tasks` (`agent_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE TABLE `toolkits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `toolkits_project_idx` ON `toolkits` (`project_id`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`toolkit_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`input_schema` text DEFAULT '{}' NOT NULL,
	`output_schema` text,
	`implementation` text DEFAULT '' NOT NULL,
	`required_permissions` text DEFAULT '[]' NOT NULL,
	`timeout_ms` integer DEFAULT 60000 NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`toolkit_id`) REFERENCES `toolkits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tools_toolkit_idx` ON `tools` (`toolkit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tools_toolkit_name_unique` ON `tools` (`toolkit_id`,`name`);--> statement-breakpoint
CREATE TABLE `workflow_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	`condition` text,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_edges_workflow_idx` ON `workflow_edges` (`workflow_id`);--> statement-breakpoint
CREATE TABLE `workflow_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_nodes_workflow_idx` ON `workflow_nodes` (`workflow_id`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflows_project_idx` ON `workflows` (`project_id`);