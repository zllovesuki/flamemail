import { rm } from "node:fs/promises";

const LOCAL_D1_STATE_DIR = ".wrangler/state/v3/d1";

await rm(LOCAL_D1_STATE_DIR, { recursive: true, force: true });

console.log(`Removed local D1 state at ${LOCAL_D1_STATE_DIR}`);
