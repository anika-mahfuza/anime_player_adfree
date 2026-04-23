import { handleNodeRequest } from '../src/app.js';

export default async function handler(req, res) {
  return handleNodeRequest(req, res);
}
