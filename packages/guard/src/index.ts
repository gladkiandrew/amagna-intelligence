export { checkWrite, isAbsoluteish } from './check.js';
export type { CheckContext, Decision, WriteAttempt } from './check.js';
export { evaluate, runHook, WRITE_TOOLS } from './hook.js';
export type { HookPayload, HookResult, RunHookOptions } from './hook.js';
export { loadScopeTable, parseScopeTable, ScopeTableError } from './scopes.js';
export type { ScopeTable } from './scopes.js';
