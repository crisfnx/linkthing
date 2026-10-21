// Messages between the UI and the extraction worker (PRD §8.2). M0 has only
// the ping; scan, start, progress, done, error, cancel and load arrive with the
// milestones that need them.

export type WorkerRequest = { id: number; type: "ping" };

export type WorkerResponse = { id: number; type: "pong" };
