import pc from "picocolors";
import { RunConfig, StatusMessage, TelemetryEvent } from "../types.js";

export class TerminalRenderer {
  private config: RunConfig;
  private hostUrl: string;
  private startTime: number = Date.now();
  private lastRenderTime: number = 0;
  private recentEpisodes: Array<{ ep: number; reward: number; length: number }> = [];
  private minReward: number = Infinity;
  private maxReward: number = -Infinity;
  private lastMeanReward: number | null = null;
  private isFinished: boolean = false;

  constructor(config: RunConfig, hostUrl: string) {
    this.config = config;
    this.hostUrl = hostUrl;
  }

  start(): void {
    this.startTime = Date.now();
    // Hide cursor during active live rendering
    process.stdout.write("\x1b[?25l");
    this.renderHeader();
  }

  private renderHeader(): void {
    console.log();
    console.log(
      pc.bold(pc.cyan("  ? EXTERM ")) +
        pc.dim("?") +
        pc.white(` Env: `) +
        pc.bold(pc.green(this.config.env_id)) +
        pc.dim(" ?") +
        pc.white(` Algo: `) +
        pc.bold(pc.magenta(this.config.algorithm)) +
        pc.dim(" ?") +
        pc.white(` Budget: `) +
        pc.yellow(this.config.total_timesteps.toLocaleString()) +
        pc.dim(" steps")
    );
    console.log(pc.dim("  " + "?".repeat(64)));
  }

  onTelemetry(event: TelemetryEvent): void {
    if (this.isFinished) return;

    if (event.episode_reward !== null && event.episode_reward !== undefined) {
      const r = event.episode_reward;
      const l = event.episode_length || 0;
      if (r < this.minReward) this.minReward = r;
      if (r > this.maxReward) this.maxReward = r;
      this.recentEpisodes.push({ ep: event.episode_count, reward: r, length: l });
      if (this.recentEpisodes.length > 5) {
        this.recentEpisodes.shift();
      }
    }

    const now = Date.now();
    // Throttle rendering to ~20 fps to avoid terminal jitter
    if (now - this.lastRenderTime > 50 || event.progress >= 1.0) {
      this.renderLive(event);
      this.lastRenderTime = now;
    }
  }

  private renderLive(event: TelemetryEvent): void {
    const elapsed = Math.max((Date.now() - this.startTime) / 1000, 0.1);
    const progress = Math.min(Math.max(event.progress, 0), 1.0);
    const pct = (progress * 100).toFixed(1);

    // Calculate ETA
    let etaStr = "--";
    if (progress > 0.02 && event.fps > 0) {
      const remainingSteps = Math.max(event.total_timesteps - event.timesteps, 0);
      const etaSeconds = remainingSteps / event.fps;
      etaStr = `${etaSeconds.toFixed(1)}s`;
    }

    // Progress Bar
    const barWidth = 26;
    const filled = Math.round(progress * barWidth);
    const empty = barWidth - filled;
    const bar = pc.cyan("?".repeat(filled)) + pc.dim("?".repeat(empty));

    // Trend Indicator
    let trend = pc.dim("?");
    if (event.mean_reward_100 !== null && event.mean_reward_100 !== undefined) {
      if (this.lastMeanReward !== null) {
        if (event.mean_reward_100 > this.lastMeanReward + 0.5) {
          trend = pc.green("?");
        } else if (event.mean_reward_100 < this.lastMeanReward - 0.5) {
          trend = pc.red("?");
        }
      }
      this.lastMeanReward = event.mean_reward_100;
    }

    const meanRewardStr =
      event.mean_reward_100 !== null && event.mean_reward_100 !== undefined
        ? pc.bold(pc.yellow(event.mean_reward_100.toFixed(1)))
        : pc.dim("calculating...");

    const latestEpStr =
      event.episode_reward !== null && event.episode_reward !== undefined
        ? pc.green(`+${event.episode_reward.toFixed(1)}`)
        : pc.dim("--");

    const lines: string[] = [
      `  ${bar}  ${pc.bold(pct + "%")}  ${pc.dim(`(${event.timesteps.toLocaleString()} / ${event.total_timesteps.toLocaleString()})`)}`,
      `  ${pc.dim("Speed:")} ${pc.white(event.fps.toLocaleString())} fps   ${pc.dim("Elapsed:")} ${pc.white(elapsed.toFixed(1) + "s")}   ${pc.dim("ETA:")} ${pc.white(etaStr)}`,
      ``,
      `  ${pc.dim("Episodes:")} ${pc.bold(pc.white(event.episode_count.toLocaleString()))}   ${pc.dim("Mean (100 ep):")} ${meanRewardStr} ${trend}   ${pc.dim("Latest:")} ${latestEpStr}`,
      `  ${pc.dim("Min Reward:")} ${this.minReward === Infinity ? "--" : pc.red(this.minReward.toFixed(1))}   ${pc.dim("Max Reward:")} ${this.maxReward === -Infinity ? "--" : pc.green(this.maxReward.toFixed(1))}`,
    ];

    // Clear previous live block and rewrite
    // We move up 5 lines and rewrite in place
    process.stdout.write(`\x1b[5A\x1b[0J`);
    process.stdout.write(lines.join("\n") + "\n");
  }

  finish(finalStatus?: StatusMessage | null): void {
    if (this.isFinished) return;
    this.isFinished = true;

    // Restore cursor
    process.stdout.write("\x1b[?25h");

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const epCount = finalStatus?.episodes || this.recentEpisodes.length;
    const meanR = finalStatus?.mean_reward_100 ?? this.lastMeanReward;

    console.log();
    console.log(pc.dim("  " + "?".repeat(64)));
    console.log(
      pc.bold(pc.green("  ? Training Completed Successfully!"))
    );
    console.log();
    console.log(`    ${pc.dim("?")} ${pc.white("Total Timesteps:")}  ${pc.bold(this.config.total_timesteps.toLocaleString())}`);
    console.log(`    ${pc.dim("?")} ${pc.white("Total Episodes:")}   ${pc.bold(epCount.toLocaleString())}`);
    console.log(`    ${pc.dim("?")} ${pc.white("100-Ep Mean Reward:")} ${meanR !== null && meanR !== undefined ? pc.bold(pc.yellow(meanR.toFixed(2))) : "--"}`);
    console.log(`    ${pc.dim("?")} ${pc.white("Peak Reward Score:")}  ${this.maxReward === -Infinity ? "--" : pc.bold(pc.green(this.maxReward.toFixed(2)))}`);
    console.log(`    ${pc.dim("?")} ${pc.white("Total Time Taken:")}  ${pc.bold(elapsed + "s")}`);
    console.log();
  }

  fail(error: string): void {
    this.isFinished = true;
    process.stdout.write("\x1b[?25h");
    console.log();
    console.log(pc.bold(pc.red(`  ? Training Failed:`)) + ` ${error}`);
    console.log();
  }
}
