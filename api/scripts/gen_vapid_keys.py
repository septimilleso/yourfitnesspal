"""Generate a P-256 VAPID key pair and print it as .env assignments."""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def main() -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    public_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )

    private_value = base64.urlsafe_b64encode(private_bytes).decode("ascii").rstrip("=")
    public_value = base64.urlsafe_b64encode(public_bytes).decode("ascii").rstrip("=")
    print(f"VAPID_PRIVATE_KEY={private_value}")
    print(f"VAPID_PUBLIC_KEY={public_value}")


if __name__ == "__main__":
    main()
