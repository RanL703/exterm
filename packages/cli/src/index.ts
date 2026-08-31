import { Command } from "commander";
import { trainCommand } from "./commands/train.js";
import { serveCommand } from "./commands/serve.js";
import { initCommand } from "./commands/init.js";
import { steerCommand } from "./commands/steer.js";
import { rollbackCommand } from "./commands/rollback.js";
import { dashboardCommand } from "./commands/dashboard.js";

const program = new Command();

program
  .name("exterm")
  .description("Terminal-native CLI to scaffold, train, and steer reinforcement learning agents")
  .version("0.1.0");

program
  .command("init")
  .description("Conversationally scaffold a new RL agent project")
  .option("-d, --dir <path>", "Target directory (default: ./<project-name>)")
  .option("-y, --yes", "Accept all defaults without prompting")
  .action(initCommand);

program
  .command("train")
  .description("Start or connect to an RL training session")
  .option("-e, --env <envId>", "Gymnasium environment ID", "CartPole-v1")
  .option("-a, --algo <algorithm>", "RL algorithm (PPO, DQN, SAC, etc.)", "PPO")
  .option("-s, --steps <timesteps>", "Total training timesteps budget", "50000")
  .option("-H, --host <url>", "Trainer server HTTP URL (auto-detected if omitted)")
  .option("--no-spawn", "Do not auto-spawn local trainer if not running")
  .option("--seed <seed>", "Random seed for reproducibility")
  .option("-t, --token <token>", "Bearer token for authentication (remote mode)")
  .option("--no-interactive", "Disable interactive steering mode")
  .action(trainCommand);

program
  .command("serve")
  .description("Run the exterm trainer server process")
  .option("-h, --host <host>", "Host address to bind", "127.0.0.1")
  .option("-p, --port <port>", "Port to bind", "8765")
  .action(serveCommand);

program
  .command("steer")
  .description("Steer a running training session with natural language")
  .argument("[instruction]", "Natural language steering instruction")
  .option("-H, --host <url>", "Trainer server HTTP URL (auto-detected if omitted)")
  .option("-c, --confirm", "Confirm a pending steering change")
  .option("--checkpoint <id>", "Checkpoint ID for confirmation")
  .option("-t, --token <token>", "Bearer token for authentication (remote mode)")
  .action(steerCommand);

program
  .command("rollback")
  .description("Rollback to a previous checkpoint (code + weights)")
  .option("-H, --host <url>", "Trainer server HTTP URL (auto-detected if omitted)")
  .option("-c, --checkpoint <id>", "Checkpoint ID to rollback to")
  .option("-l, --list", "List available checkpoints")
  .option("-t, --token <token>", "Bearer token for authentication (remote mode)")
  .action(rollbackCommand);

program
  .command("dashboard")
  .description("Launch the web dashboard to visualize training")
  .option("-H, --host <url>", "Trainer server HTTP URL (auto-detected if omitted)")
  .option("-p, --port <port>", "Dashboard port", "3000")
  .option("--no-open", "Do not open browser automatically")
  .option("-t, --token <token>", "Bearer token for authentication (remote mode)")
  .action(dashboardCommand);

program.parse(process.argv);
