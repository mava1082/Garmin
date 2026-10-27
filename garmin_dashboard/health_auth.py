"""One-time OAuth 1.0a authorization for the official Garmin Health API.

Usage: python -m garmin_dashboard.health_auth
Prints GARMIN_ACCESS_TOKEN / GARMIN_ACCESS_TOKEN_SECRET to paste into .env.
"""

from __future__ import annotations

from .config import config

REQUEST_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/request_token"
AUTHORIZE_URL = "https://connect.garmin.com/oauthConfirm"
ACCESS_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/access_token"


def main() -> None:
    from requests_oauthlib import OAuth1Session

    if not (config.consumer_key and config.consumer_secret):
        raise SystemExit("Sätt GARMIN_CONSUMER_KEY och GARMIN_CONSUMER_SECRET i .env först.")

    oauth = OAuth1Session(config.consumer_key, client_secret=config.consumer_secret, callback_uri="oob")
    tokens = oauth.fetch_request_token(REQUEST_TOKEN_URL)
    print("\n1. Öppna den här länken och godkänn appen:\n")
    print("  ", oauth.authorization_url(AUTHORIZE_URL))
    verifier = input("\n2. Klistra in verifieringskoden (oauth_verifier): ").strip()

    oauth = OAuth1Session(
        config.consumer_key,
        client_secret=config.consumer_secret,
        resource_owner_key=tokens["oauth_token"],
        resource_owner_secret=tokens["oauth_token_secret"],
        verifier=verifier,
    )
    access = oauth.fetch_access_token(ACCESS_TOKEN_URL)
    print("\n3. Lägg till i .env:\n")
    print(f"GARMIN_ACCESS_TOKEN={access['oauth_token']}")
    print(f"GARMIN_ACCESS_TOKEN_SECRET={access['oauth_token_secret']}")


if __name__ == "__main__":
    main()
