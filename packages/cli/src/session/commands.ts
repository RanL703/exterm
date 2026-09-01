export type CommandHandler = (args: string[]) => Promise<void>;

export class CommandRegistry {
  private readonly handlers: Map<string, CommandHandler>;

  constructor(handlers: Record<string, CommandHandler>) {
    this.handlers = new Map(Object.entries(handlers));
  }

  async execute(name: string, args: string[]): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      await this.handlers.get("help")?.([]);
      return;
    }
    await handler(args);
  }
}
