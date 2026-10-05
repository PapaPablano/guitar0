import { runMatchJob, type MatchJob, type MatchJobResult } from './job';

export type WorkerMessage = { type: 'run'; job: MatchJob };

export type WorkerReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result: MatchJobResult }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerMessage>) => void) | null;
  postMessage(message: WorkerReply): void;
};

scope.onmessage = (e) => {
  try {
    const result = runMatchJob(e.data.job, (fraction) => scope.postMessage({ type: 'progress', fraction }));
    scope.postMessage({ type: 'done', result });
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
