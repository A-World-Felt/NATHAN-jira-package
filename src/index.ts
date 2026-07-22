// src/index.ts
export { JiraClient } from './jira-client.js';
export { loadConfig } from './config.js';
export { sessionFromDate, statusInfo, computeOrder, findOrphanDeps, hasCycle } from './mapping.js';
export type {
  Task, Config, StatusCategory, PlanFieldDiff, PlanItem, SeedPlan,
  JiraHttpClient, JiraConnConfig,
} from './types.js';
export { parseTasks } from './taches-parser.js';
export { renderRow, regenerate } from './taches-writer.js';
export { textToAdf, adfToText } from './adf.js';
export {
  fileTimestamp,
  isRealJiraKey,
  hoursToJiraDuration,
  resolveAccountId,
  createEpic,
  createTask,
  createSubtask,
  getCurrentStatus,
  transitionTo,
  setAssignee,
  setEstimate,
  linkDep,
  restructureOriginal,
  deleteIssue,
  deleteIssueLink,
  carryStatusThenDelete,
  createRisk,
} from './jira-write.js';
export type { JiraWriteClient, DepType } from './jira-write.js';
export { deriveCategory, lintSummary } from './jira-conventions.js';
export {
  fetchFullSnapshot,
  summarizeSnapshot,
  indexSnapshot,
} from './snapshot.js';
export type { RawIssue, JiraSnapshot, SnapshotIndex } from './snapshot.js';
export { diffSnapshot, canApplyRestore, revertFields } from './restore.js';
export type { FieldDiff, SnapshotDiff } from './restore.js';
export { refreshTaches } from './taches-sync.js';
export type { RefreshResult, RefreshStats } from './taches-sync.js';
export {
  checkChanges,
  dryRun,
  canApply,
  updateFields,
  applyChanges,
} from './taches-apply.js';
export type {
  ChangeSet,
  CreateChange,
  UpdateChange,
  DeleteChange,
  ChangeDep,
  SubtaskChange,
  ChangeCheck,
  ApplyResult,
} from './taches-apply.js';
export {
  overdueTasks, upcomingTasks, inProgressTasks, blockedTasks, tasksByPerson, metrics,
} from './analysis.js';
export type {
  AnalysisTask, TaskBrief, OverdueBrief, Metrics, ProjectMetrics, MetricsInput,
} from './analysis.js';
export { loadProfile } from './profile.js';
export type {
  ConventionProfile, RouteIntent, RouteResult, LintResult, StatusVocab,
} from './profile.js';
