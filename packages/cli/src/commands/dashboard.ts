import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardOptions {
  host?: string;
  port?: string;
  open?: boolean;
  token?: string;
}

export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  const host = options.host || "http://127.0.0.1:8765";
  const port = options.port || "3000";
  const shouldOpen = options.open !== false;
  const token = options.token;

  const dashboardDir = path.resolve(__dirname, "../../dashboard");

  console.log(pc.bold(pc.cyan("\n  exterm dashboard")) + pc.dim(` - Starting on http://localhost:${port}\n`));
  console.log(pc.dim(`  Connecting to trainer at ${host}`));

  // Build dashboard if needed
  const distDir = path.join(dashboardDir, "dist");
  const { existsSync } = await import("node:fs");
  if (!existsSync(distDir)) {
    console.log(pc.dim("  Building dashboard..."));
    await runCommand("npm", ["run", "build"], { cwd: dashboardDir });
  }

  // Set environment variables for the dashboard
  const env = {
    ...process.env,
    VITE_TRAINER_HOST: host,
    VITE_TRAINER_TOKEN: token || "",
  };

  const child = spawn("npx", ["vite", "preview", "--port", port, "--host"], {
    cwd: dashboardDir,
    stdio: "inherit",
    env,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Open browser
  if (shouldOpen) {
    setTimeout(() => {
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(openCmd, [`http://localhost:${port}`], { detached: true, stdio: "ignore" }).unref();
    }, 1000);
  }
}

function runCommand(cmd: string, args: string[], options: { cwd: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, stdio: "inherit", shell: true });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    child.on("error", reject);
  });
}