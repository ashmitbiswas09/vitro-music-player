/**
 * Shared types for CLI commands.
 */

export interface CliTiming {
  coldStartTimeMs: number;
  commandExecutionMs?: number;
  parseTimeMs?: number;
  responseSizeBytes?: number;
  totalTimeMs: number;
}
