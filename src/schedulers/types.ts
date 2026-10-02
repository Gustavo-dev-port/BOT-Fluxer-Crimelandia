/** Algo que o desligamento do worker precisa parar (tarefa do cron, timer). */
export interface Stoppable {
  stop(): unknown;
}
