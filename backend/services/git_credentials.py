"""Helpers for authenticating Git commands without putting tokens in URLs."""

import os
import re
import base64
from urllib.parse import urlsplit, urlunsplit


_CREDENTIAL_URL_PATTERN = re.compile(r"(?P<scheme>https?://)(?P<userinfo>[^/\s@]+)@")
ALLOWED_CLONE_HOST = "github.com"


def sanitize_git_url(url: str) -> str:
    """Remove any URL userinfo before it is stored, displayed, or executed."""
    if not url:
        return ""

    try:
        parsed = urlsplit(url)
        if parsed.scheme and parsed.netloc:
            hostname = parsed.hostname or ""
            if parsed.port:
                hostname = f"{hostname}:{parsed.port}"
            return urlunsplit((parsed.scheme, hostname, parsed.path, parsed.query, parsed.fragment))
    except ValueError:
        pass

    return _CREDENTIAL_URL_PATTERN.sub(r"\g<scheme>", url)


def normalize_historical_remote_url(url: str) -> tuple[str, str]:
    """Return a safe cleanup status and normalized URL without exposing userinfo."""
    if not isinstance(url, str) or not url.strip():
        return "manual_review", "Remote URL is empty or malformed."

    try:
        parsed = urlsplit(url.strip())
        if parsed.scheme.lower() not in {"http", "https", "ssh", "git+ssh"}:
            return "manual_review", "Remote URL uses an unsupported scheme."
        if not parsed.hostname or not parsed.netloc:
            return "manual_review", "Remote URL is malformed."
        if parsed.username is None and parsed.password is None:
            return "clean", url.strip()

        hostname = parsed.hostname.lower()
        port = parsed.port
        netloc = hostname if port is None else f"{hostname}:{port}"
        normalized = urlunsplit(
            (parsed.scheme.lower(), netloc, parsed.path, parsed.query, parsed.fragment)
        )
        return "cleanup_required", normalized
    except ValueError:
        return "manual_review", "Remote URL is malformed."


def validate_clone_url(url: str) -> tuple[bool, str]:
    """Validate a clone URL before any Git process receives credentials."""
    if not isinstance(url, str) or not url.strip():
        return False, "Clone URL is required."

    try:
        parsed = urlsplit(url.strip())
        hostname = parsed.hostname.lower() if parsed.hostname else ""
        port = parsed.port
    except ValueError:
        return False, "Clone URL is malformed."

    if parsed.scheme.lower() != "https":
        return False, "Only HTTPS GitHub clone URLs are supported."
    if hostname != ALLOWED_CLONE_HOST or port not in (None, 443):
        return False, "Only github.com clone URLs are supported."
    if "@" in parsed.netloc or parsed.username is not None or parsed.password is not None:
        return False, "Clone URL credentials are not allowed."
    if parsed.query or parsed.fragment or not parsed.path or parsed.path == "/":
        return False, "Clone URL must identify a GitHub repository."

    return True, sanitize_git_url(url.strip())


def redact_git_output(output: str, token: str = "") -> str:
    """Remove tokens and credential-bearing URLs from Git diagnostics."""
    redacted = output or ""
    if token:
        redacted = redacted.replace(token, "[REDACTED]")
    return _CREDENTIAL_URL_PATTERN.sub(r"\g<scheme>[REDACTED]@", redacted)


def build_git_clone_command(clone_url: str, dest_path: str) -> list[str]:
    """Build a clone command that cannot persist credentials in the remote URL."""
    valid, result = validate_clone_url(clone_url)
    if not valid:
        raise ValueError(result)

    return [
        "git",
        "-c",
        "credential.helper=",
        "clone",
        result,
        dest_path,
    ]


def build_git_environment(token: str) -> dict[str, str]:
    """Provide Git transient HTTP authentication without putting it in argv."""
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    credentials = base64.b64encode(f"x-access-token:{token or ''}".encode()).decode()
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "http.extraheader"
    env["GIT_CONFIG_VALUE_0"] = f"Authorization: Basic {credentials}"
    return env
