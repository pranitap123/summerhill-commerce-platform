// Public API of the support module (G5-11): customer issues and the auto-approval policy.
export { ISSUE_TYPES, ISSUE_SCENARIO, decideIssue } from './policy'
export type { IssueType, PolicyConfig, PolicyInput, PolicyDecision } from './policy'
export {
  ISSUE_WINDOW_MS,
  canReportIssue,
  reportIssue,
  resolveIssue,
  getIssue,
  listIssues,
  issueContext,
} from './issues'
export type { SupportIssue } from './issues'
