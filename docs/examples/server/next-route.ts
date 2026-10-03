// app/api/aptuitive/[kind]/route.ts: one route serves both /plan and /command.
import { handler } from './handler.js';

export const POST = handler;
