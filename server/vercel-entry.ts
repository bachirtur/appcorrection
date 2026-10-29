import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './index';

const { app: expressApp } = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? req.url : `/${req.url}`}`;
  }
  return expressApp(req, res);
}
