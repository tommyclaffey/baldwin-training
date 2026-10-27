// Runs the API server (port 4610, data in ./data) and Vite (5181) together.
import { spawn } from 'node:child_process';
const api = spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: '4610', DATA_DIR: process.env.DATA_DIR || './data', OWNER_EMAIL: process.env.OWNER_EMAIL || 'owner@example.test' } });
const web = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });
const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
