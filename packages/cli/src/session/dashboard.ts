import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard");

export async function launchDashboard(host: string, token: string | undefined, port = 4173): Promise<string> {
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, VITE_TRAINER_HOST: host, VITE_TRAINER_TOKEN: token || "" };
  await run("npm", ["run", "build"], env);
  if (await isReachable(url)) {
    openBrowser(url);
    return url;
  }
  const child = spawn("npx", ["vite", "preview", "--port", String(port), "--host", "127.0.0.1"], { cwd: dashboardDir, env, stdio: "ignore" });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isReachable(url)) { openBrowser(url); return url; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dashboard did not start on ${url}`);
}

async function isReachable(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(300) })).ok; } catch { return false; }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: dashboardDir, env, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`dashboard build failed with code ${code}`)));
  });
}

function openBrowser(url: string): void {
  if (process.env.EXTERM_NO_OPEN === "1") return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
}
