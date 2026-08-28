import argparse
import uvicorn


def main():
    parser = argparse.ArgumentParser(description="exterm RL trainer server")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address to bind")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for dev")

    args = parser.parse_args()

    print(f"Starting exterm trainer on http://{args.host}:{args.port}")
    uvicorn.run(
        "exterm_trainer.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
