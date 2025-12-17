# Token Troubleshooting Guide

## Current Setup

Your Claude Desktop config only needs client credentials:

```json
"whoop": {
  "command": "node",
  "args": ["/path/to/whoop-mcp-server/dist/index.js"],
  "env": {
    "WHOOP_CLIENT_ID": "your-client-id",
    "WHOOP_CLIENT_SECRET": "your-client-secret"
  }
}
```

Tokens are stored in: `tokens.json` (in the server directory, auto-managed)

## Quick Fixes

### Problem: "Failed to refresh token" or "No refresh token available"

Your refresh token has expired. Re-authenticate:

```bash
cd /path/to/whoop-mcp-server
node get-tokens.mjs
```

Then either:
- Add the new tokens to your Claude config temporarily, OR
- Manually create `tokens.json`:

```bash
cat > tokens.json << 'EOF'
{
  "accessToken": "YOUR_NEW_ACCESS_TOKEN",
  "refreshToken": "YOUR_NEW_REFRESH_TOKEN",
  "expiresAt": 1
}
EOF
```

(Setting `expiresAt: 1` forces an immediate refresh on first use)

### Problem: "Missing WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET"

These must be in your Claude Desktop config. They never expire.

Config location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Problem: Server not loading persisted tokens

Check the token file exists and is readable:

```bash
ls -la tokens.json
cat tokens.json
```

### Force fresh start

Delete persisted tokens and re-authenticate:

```bash
rm tokens.json
node get-tokens.mjs
```

## How It Works

1. **Startup**: Server loads `tokens.json` (or falls back to env vars)
2. **API call**: If token expired, auto-refresh using client credentials + refresh token
3. **After refresh**: New tokens saved to `tokens.json`
4. **Restart**: Loads from `tokens.json` - no manual intervention needed

## Reference

| Item | Location |
|------|----------|
| Claude config (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude config (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Token file | `tokens.json` (in server directory) |
| Token helper | `get-tokens.mjs` (in server directory) |
