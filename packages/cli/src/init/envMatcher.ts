export type ActionSpaceType = "discrete" | "continuous" | "continuous_easy";

export interface EnvEntry {
  id: string;
  name: string;
  description: string;
  actionSpace: ActionSpaceType;
  /** Human difficulty: "easy" | "medium" | "hard" */
  difficulty: "easy" | "medium" | "hard";
  /** Reward density: "dense" | "sparse" */
  rewardDensity: "dense" | "sparse";
  /** Tags for keyword matching */
  tags: string[];
  defaultSteps: number;
}

export const ENV_REGISTRY: EnvEntry[] = [
  {
    id: "CartPole-v1",
    name: "CartPole",
    description: "Balance a pole on a moving cart by pushing left or right.",
    actionSpace: "discrete",
    difficulty: "easy",
    rewardDensity: "dense",
    tags: ["balance", "pole", "cart", "cartpole", "pendulum cart", "classic", "simple", "control", "inverted"],
    defaultSteps: 50_000,
  },
  {
    id: "MountainCar-v0",
    name: "MountainCar",
    description: "Drive a car up a steep mountain by building momentum.",
    actionSpace: "discrete",
    difficulty: "hard",
    rewardDensity: "sparse",
    tags: ["car", "mountain", "drive", "momentum", "hill", "mountaincar", "climb", "slope"],
    defaultSteps: 100_000,
  },
  {
    id: "MountainCarContinuous-v0",
    name: "MountainCar (Continuous)",
    description: "Drive a car up a steep mountain with continuous throttle control.",
    actionSpace: "continuous",
    difficulty: "hard",
    rewardDensity: "sparse",
    tags: ["car", "mountain", "drive", "momentum", "continuous", "throttle", "hill", "mountaincar"],
    defaultSteps: 100_000,
  },
  {
    id: "Pendulum-v1",
    name: "Pendulum Swing-Up",
    description: "Swing a pendulum upright and keep it balanced with continuous torque.",
    actionSpace: "continuous",
    difficulty: "medium",
    rewardDensity: "dense",
    tags: ["pendulum", "swing", "upright", "torque", "continuous", "rotation", "balance", "pole"],
    defaultSteps: 100_000,
  },
  {
    id: "Acrobot-v1",
    name: "Acrobot",
    description: "Swing a two-link robotic arm to reach a target height.",
    actionSpace: "discrete",
    difficulty: "medium",
    rewardDensity: "sparse",
    tags: ["acrobot", "robot", "arm", "swing", "link", "reach", "height", "two link"],
    defaultSteps: 100_000,
  },
  {
    id: "LunarLander-v3",
    name: "Lunar Lander",
    description: "Land a spacecraft on the moon using thrusters ? fuel-efficient landings score higher.",
    actionSpace: "discrete",
    difficulty: "medium",
    rewardDensity: "dense",
    tags: ["lunar", "lander", "spacecraft", "moon", "thruster", "landing", "fuel", "space", "rocket", "fly", "flight"],
    defaultSteps: 200_000,
  },
  {
    id: "LunarLanderContinuous-v3",
    name: "Lunar Lander (Continuous)",
    description: "Land a spacecraft on the moon with continuous thrust ? smoother but harder to control.",
    actionSpace: "continuous",
    difficulty: "hard",
    rewardDensity: "dense",
    tags: ["lunar", "lander", "continuous", "spacecraft", "moon", "thruster", "landing", "smooth", "space", "rocket"],
    defaultSteps: 300_000,
  },
  {
    id: "BipedalWalker-v3",
    name: "Bipedal Walker",
    description: "Teach a 2D bipedal robot to walk on uneven terrain without falling.",
    actionSpace: "continuous",
    difficulty: "hard",
    rewardDensity: "dense",
    tags: ["walk", "bipedal", "robot", "legs", "terrain", "locomotion", "humanoid", "run", "gait"],
    defaultSteps: 500_000,
  },
  {
    id: "HalfCheetah-v5",
    name: "HalfCheetah (MuJoCo)",
    description: "Make a simulated cheetah robot run as fast as possible.",
    actionSpace: "continuous",
    difficulty: "medium",
    rewardDensity: "dense",
    tags: ["cheetah", "mujoco", "run", "speed", "fast", "robot", "locomotion", "quadruped"],
    defaultSteps: 1_000_000,
  },
  {
    id: "Hopper-v5",
    name: "Hopper (MuJoCo)",
    description: "Make a one-legged robot hop forward as fast as possible without falling.",
    actionSpace: "continuous",
    difficulty: "medium",
    rewardDensity: "dense",
    tags: ["hopper", "hop", "jump", "mujoco", "robot", "leg", "one leg", "bounce"],
    defaultSteps: 1_000_000,
  },
  {
    id: "Ant-v5",
    name: "Ant (MuJoCo)",
    description: "Control a 4-legged ant robot to move forward as fast as possible.",
    actionSpace: "continuous",
    difficulty: "hard",
    rewardDensity: "dense",
    tags: ["ant", "mujoco", "four legs", "robot", "locomotion", "walk", "run"],
    defaultSteps: 1_000_000,
  },
  {
    id: "Walker2d-v5",
    name: "Walker2d (MuJoCo)",
    description: "Make a 2D bipedal walker robot move forward as fast as possible.",
    actionSpace: "continuous",
    difficulty: "medium",
    rewardDensity: "dense",
    tags: ["walker", "walk", "mujoco", "bipedal", "robot", "legs", "locomotion"],
    defaultSteps: 1_000_000,
  },
  {
    id: "Humanoid-v5",
    name: "Humanoid (MuJoCo)",
    description: "Control a 3D humanoid robot to walk forward without falling.",
    actionSpace: "continuous",
    difficulty: "hard",
    rewardDensity: "dense",
    tags: ["humanoid", "human", "mujoco", "walk", "robot", "3d", "bipedal", "locomotion"],
    defaultSteps: 2_000_000,
  },
  {
    id: "Swimmer-v5",
    name: "Swimmer (MuJoCo)",
    description: "Control a swimming robot to move through fluid.",
    actionSpace: "continuous",
    difficulty: "easy",
    rewardDensity: "dense",
    tags: ["swimmer", "swim", "mujoco", "robot", "fluid", "locomotion"],
    defaultSteps: 500_000,
  },
  {
    id: "Reacher-v5",
    name: "Reacher (MuJoCo)",
    description: "Control a robotic arm to reach a target position.",
    actionSpace: "continuous",
    difficulty: "easy",
    rewardDensity: "dense",
    tags: ["reacher", "reach", "mujoco", "robot", "arm", "target"],
    defaultSteps: 200_000,
  },
  {
    id: "Pusher-v5",
    name: "Pusher (MuJoCo)",
    description: "Control a robotic arm to push an object to a target location.",
    actionSpace: "continuous",
    difficulty: "medium",
    rewardDensity: "sparse",
    tags: ["pusher", "push", "mujoco", "robot", "arm", "object", "target"],
    defaultSteps: 500_000,
  },
  {
    id: "Thrower-v5",
    name: "Thrower (MuJoCo)",
    description: "Control a robotic arm to throw a ball to a target location.",
    actionSpace: "continuous",
    difficulty: "hard",
    rewardDensity: "sparse",
    tags: ["thrower", "throw", "mujoco", "robot", "arm", "ball", "target"],
    defaultSteps: 1_000_000,
  },
  // Atari environments
  {
    id: "ALE/Pong-v5",
    name: "Pong (Atari)",
    description: "Classic Pong game - control a paddle to hit the ball past your opponent.",
    actionSpace: "discrete",
    difficulty: "medium",
    rewardDensity: "sparse",
    tags: ["pong", "atari", "game", "paddle", "ball", "classic", "arcade"],
    defaultSteps: 1_000_000,
  },
  {
    id: "ALE/Breakout-v5",
    name: "Breakout (Atari)",
    description: "Breakout game - control a paddle to bounce a ball and break bricks.",
    actionSpace: "discrete",
    difficulty: "medium",
    rewardDensity: "sparse",
    tags: ["breakout", "atari", "game", "paddle", "ball", "bricks", "classic", "arcade"],
    defaultSteps: 1_000_000,
  },
  {
    id: "ALE/SpaceInvaders-v5",
    name: "Space Invaders (Atari)",
    description: "Space Invaders - shoot down waves of alien invaders.",
    actionSpace: "discrete",
    difficulty: "medium",
    rewardDensity: "sparse",
    tags: ["spaceinvaders", "space", "invaders", "atari", "game", "shoot", "aliens", "classic", "arcade"],
    defaultSteps: 1_000_000,
  },
  {
    id: "ALE/Seaquest-v5",
    name: "Seaquest (Atari)",
    description: "Seaquest - submarine game rescuing divers while avoiding enemies.",
    actionSpace: "discrete",
    difficulty: "hard",
    rewardDensity: "sparse",
    tags: ["seaquest", "atari", "game", "submarine", "divers", "enemies", "classic", "arcade"],
    defaultSteps: 2_000_000,
  },
  {
    id: "ALE/BeamRider-v5",
    name: "Beam Rider (Atari)",
    description: "Beam Rider - fly along a beam shooting enemies.",
    actionSpace: "discrete",
    difficulty: "medium",
    rewardDensity: "sparse",
    tags: ["beamrider", "beam", "rider", "atari", "game", "fly", "shoot", "classic", "arcade"],
    defaultSteps: 1_000_000,
  },
  {
    id: "ALE/Qbert-v5",
    name: "Q*bert (Atari)",
    description: "Q*bert - jump on cubes to change their color while avoiding enemies.",
    actionSpace: "discrete",
    difficulty: "hard",
    rewardDensity: "sparse",
    tags: ["qbert", "q*bert", "atari", "game", "jump", "cubes", "colors", "classic", "arcade"],
    defaultSteps: 2_000_000,
  },
  {
    id: "ALE/Enduro-v5",
    name: "Enduro (Atari)",
    description: "Enduro - racing game avoiding other cars.",
    actionSpace: "discrete",
    difficulty: "medium",
    rewardDensity: "sparse",
    tags: ["enduro", "atari", "game", "racing", "car", "drive", "classic", "arcade"],
    defaultSteps: 1_000_000,
  },
];

export interface MatchResult {
  env: EnvEntry;
  score: number;
  matchedTags: string[];
}

/**
 * Score an environment entry against a natural language description.
 * Returns a normalized score in [0, 1].
 */
export function matchEnvironments(description: string): MatchResult[] {
  const lower = description.toLowerCase();
  const words = lower.split(/\W+/).filter(Boolean);

  const results: MatchResult[] = ENV_REGISTRY.map((env) => {
    let score = 0;
    const matchedTags: string[] = [];

    // Check each tag against the full description string and word list
    for (const tag of env.tags) {
      const tagWords = tag.split(/\s+/);
      if (lower.includes(tag)) {
        // Full tag phrase match ? high reward
        const points = tag.includes(" ") ? 4 : 2;
        score += points;
        matchedTags.push(tag);
      } else {
        // Partial: check if all words of the tag appear in description words
        const allMatch = tagWords.every((tw) => words.some((w) => w === tw || w.startsWith(tw) || tw.startsWith(w)));
        if (allMatch && tagWords.length > 0) {
          score += 1;
          matchedTags.push(tag);
        }
      }
    }

    // Bonus: description mentions env name directly
    if (lower.includes(env.name.toLowerCase())) {
      score += 5;
    }

    // Bonus: difficulty / action space hints
    if (/(smooth|continuous|fine|precise|throttle)/.test(lower) && env.actionSpace === "continuous") {
      score += 1;
    }
    if (/(simple|classic|basic|beginner|first|start)/.test(lower) && env.difficulty === "easy") {
      score += 1;
    }
    if (/(hard|difficult|challenge|complex)/.test(lower) && env.difficulty === "hard") {
      score += 1;
    }

    return { env, score, matchedTags: [...new Set(matchedTags)] };
  });

  // Sort descending by score, then alphabetically by id for stability
  results.sort((a, b) => b.score - a.score || a.env.id.localeCompare(b.env.id));

  return results;
}
