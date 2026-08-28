import { ActionSpaceType, EnvEntry } from "./envMatcher.js";

export interface AlgoConfig {
  algorithm: string;
  policy: string;
  hyperparameters: Record<string, any>;
  rationale: string;
}

/**
 * Select algorithm and hyperparameters based on the PRD defaults table:
 *   - Discrete action space ? PPO (preferred over DQN for stability)
 *   - Continuous action space ? SAC (PPO for simpler continuous tasks)
 *   - Sparse reward / hard exploration ? PPO with higher entropy bonus
 */
export function selectAlgoDefaults(env: EnvEntry): AlgoConfig {
  const { actionSpace, rewardDensity, difficulty } = env;

  // Hard exploration / sparse reward case: PPO with entropy bonus
  if (rewardDensity === "sparse" || (difficulty === "hard" && actionSpace === "discrete")) {
    return {
      algorithm: "PPO",
      policy: "MlpPolicy",
      hyperparameters: {
        ent_coef: 0.01,
        n_steps: 2048,
        batch_size: 64,
        n_epochs: 10,
        gamma: 0.99,
        gae_lambda: 0.95,
      },
      rationale:
        "PPO with elevated entropy bonus (ent_coef=0.01) ? this environment has sparse rewards or hard exploration, so extra entropy encourages the agent to explore rather than exploit prematurely.",
    };
  }

  // Discrete action space ? PPO
  if (actionSpace === "discrete") {
    return {
      algorithm: "PPO",
      policy: "MlpPolicy",
      hyperparameters: {
        n_steps: 2048,
        batch_size: 64,
        n_epochs: 10,
        gamma: 0.99,
        gae_lambda: 0.95,
        ent_coef: 0.0,
      },
      rationale:
        "PPO with SB3 defaults ? preferred for discrete action spaces for its stability and sample efficiency compared to DQN.",
    };
  }

  // Continuous action space: simple continuous (easy/medium) ? PPO, harder ? SAC
  if (actionSpace === "continuous") {
    if (difficulty === "easy" || difficulty === "medium") {
      return {
        algorithm: "SAC",
        policy: "MlpPolicy",
        hyperparameters: {
          learning_rate: 3e-4,
          buffer_size: 1_000_000,
          batch_size: 256,
          tau: 0.005,
          gamma: 0.99,
          ent_coef: "auto",
        },
        rationale:
          "SAC (Soft Actor-Critic) with SB3 defaults ? the gold standard for continuous control tasks, with automatic entropy tuning for stable exploration.",
      };
    } else {
      return {
        algorithm: "SAC",
        policy: "MlpPolicy",
        hyperparameters: {
          learning_rate: 3e-4,
          buffer_size: 1_000_000,
          batch_size: 256,
          tau: 0.005,
          gamma: 0.99,
          ent_coef: "auto",
          train_freq: 1,
          gradient_steps: 1,
        },
        rationale:
          "SAC with SB3 defaults ? for this harder continuous environment, SAC's off-policy updates and automatic entropy tuning give it the best shot at stable learning.",
      };
    }
  }

  // Fallback: PPO
  return {
    algorithm: "PPO",
    policy: "MlpPolicy",
    hyperparameters: {},
    rationale: "PPO with SB3 defaults ? sensible fallback for most environments.",
  };
}
