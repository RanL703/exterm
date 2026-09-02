import argparse
import ipaddress
import os
import secrets
import ssl
import uvicorn
from pathlib import Path


def generate_self_signed_cert(cert_path: Path, key_path: Path) -> None:
    """Generate a self-signed certificate for TLS."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime

    # Generate private key
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # Create self-signed certificate
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "exterm-trainer"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.UTC))
        .not_valid_after(datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))]),
            critical=False,
        )
        .sign(private_key, hashes.SHA256())
    )

    # Write key and cert
    key_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def main():
    parser = argparse.ArgumentParser(description="exterm RL trainer server")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address to bind")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for dev")
    parser.add_argument("--tls", action="store_true", help="Enable TLS (HTTPS/WSS)")
    parser.add_argument("--cert", type=str, help="Path to TLS certificate file")
    parser.add_argument("--key", type=str, help="Path to TLS private key file")
    parser.add_argument("--token", type=str, help="Bearer token for authentication (auto-generated if not provided)")

    args = parser.parse_args()

    # Generate token if not provided
    token = args.token or os.environ.get("EXTERM_BEARER_TOKEN") or os.environ.get("EXTERM_TOKEN") or secrets.token_urlsafe(32)

    # Set bearer token for authentication
    from .server import set_bearer_token
    set_bearer_token(token)

    # Handle TLS
    ssl_config = None
    if args.tls:
        cert_path = Path(args.cert) if args.cert else Path("cert.pem")
        key_path = Path(args.key) if args.key else Path("key.pem")

        if not cert_path.exists() or not key_path.exists():
            print("Generating self-signed TLS certificate...")
            generate_self_signed_cert(cert_path, key_path)

        ssl_config = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ssl_config.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
        protocol = "https"
        ws_protocol = "wss"
    else:
        protocol = "http"
        ws_protocol = "ws"

    print(f"Starting exterm trainer on {protocol}://{args.host}:{args.port}")
    if token:
        print(f"Bearer token: {token}")
        print(f"Use this token for CLI/dashboard authentication")

    uvicorn_kwargs = {
        "app": "exterm_trainer.server:app",
        "host": args.host,
        "port": args.port,
        "reload": args.reload,
        "log_level": "info",
    }

    if args.tls:
        cert_path = Path(args.cert) if args.cert else Path("cert.pem")
        key_path = Path(args.key) if args.key else Path("key.pem")
        uvicorn_kwargs["ssl_keyfile"] = str(key_path)
        uvicorn_kwargs["ssl_certfile"] = str(cert_path)

    uvicorn.run(**uvicorn_kwargs)


if __name__ == "__main__":
    main()
