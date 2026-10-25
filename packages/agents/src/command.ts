import { spawn } from 'node:child_process';
import { LlmError, type LlmRequest, type LlmResponse, type LlmTransport } from './llm.js';

/**
 * Pipe the prompt to any command-line model and read its answer from stdout.
 *
 * This is how a subscription-based CLI plugs in without an API key — for example
 * `claude -p` running on a Claude subscription — and how a local open-weight model
 * does with no server at all (`ollama run llama3.1`). The command comes from the
 * operator's own configuration and is run without a shell; nothing from a note, a
 * task or a model reply is ever part of it.
 */
export interface CommandTransportOptions {
  /** argv, e.g. ['claude', '-p'] or ['ollama', 'run', 'llama3.1']. */
  command: readonly string[];
  /** Label reported as the model, since a CLI may not say which model answered. */
  model?: string;
  timeoutMs?: number;
}

export function parseCommand(line: string): string[] {
  // Whitespace-separated with "double quotes" for arguments that contain spaces.
  // No shell expansion, no variables, no pipes: what you write is the argv.
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '');
}

export function createCommandTransport(options: CommandTransportOptions): LlmTransport {
  const [bin, ...args] = options.command;
  if (!bin) throw new LlmError('LLM_COMMAND is empty', null, false);
  const timeoutMs = options.timeoutMs ?? 600_000;

  return {
    kind: 'live',
    send(request: LlmRequest): Promise<LlmResponse> {
      const prompt = [
        request.system.stable,
        request.system.volatile,
        `Task:\n${request.userMessage}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new LlmError(`${bin} timed out after ${timeoutMs}ms`, null, true));
        }, timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(new LlmError(`could not start ${bin}: ${error.message}`, null, false));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new LlmError(`${bin} exited ${code}: ${err.trim().slice(0, 200)}`, null, false));
            return;
          }
          resolve({
            text: out.trim(),
            model: options.model ?? bin,
            stopReason: 'end_turn',
            refusal: null,
            usage: null,
          });
        });
        child.stdin.end(prompt);
      });
    },
  };
}
