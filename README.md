# Whoop MCP Server

An MCP (Model Context Protocol) server that provides access to your Whoop health and fitness data, enabling Claude and other AI assistants to give you personalized health recommendations.

## Features

- **Recovery Data**: Get your recovery score, HRV, resting heart rate, SpO2, and skin temperature
- **Sleep Analysis**: Detailed sleep stages (light, REM, deep), sleep performance, efficiency, and respiratory rate
- **Workout Tracking**: Strain scores, calories burned, heart rate zones, distance, and elevation
- **Daily Strain**: Cumulative daily strain and energy expenditure
- **Health Overview**: Combined view of recovery, sleep, and strain with personalized recommendations
- **Profile & Body Measurements**: User profile and body measurements data

## Prerequisites

1. **Whoop Device**: You need an active Whoop membership
2. **Whoop Developer Account**: Create an app at [developer.whoop.com](https://developer-dashboard.whoop.com)
3. **Node.js 18+**: Required to run the server

## Setup

### 1. Create a Whoop Developer App

1. Go to [developer-dashboard.whoop.com](https://developer-dashboard.whoop.com)
2. Create a new app
3. Set the redirect URL to `http://localhost:8080/callback`
4. Note your **Client ID** and **Client Secret**
5. Request the following scopes:
   - `read:recovery`
   - `read:cycles`
   - `read:workout`
   - `read:sleep`
   - `read:profile`
   - `read:body_measurement`
   - `offline` (for refresh token)

### 2. Install the MCP Server

```bash
cd whoop-mcp-server
npm install
npm run build
```

### 3. Get Your Initial Tokens (One-Time)

Run the token helper script:

```bash
node get-tokens.mjs
```

Follow the prompts to:
1. Enter your Client ID and Client Secret
2. Open the authorization URL in your browser
3. Authorize the app and copy the code from the redirect URL
4. The script will output your initial tokens

### 4. Configure Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/path/to/whoop-mcp-server/dist/index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id",
        "WHOOP_CLIENT_SECRET": "your-client-secret",
        "WHOOP_ACCESS_TOKEN": "your-initial-access-token",
        "WHOOP_REFRESH_TOKEN": "your-initial-refresh-token"
      }
    }
  }
}
```

### 5. First Use & Token Persistence

On first API call, the server will:
1. Use your initial tokens from the config
2. Save them to `tokens.json` in the server directory
3. Automatically refresh when they expire

**After initial setup**, you can remove `WHOOP_ACCESS_TOKEN` and `WHOOP_REFRESH_TOKEN` from your config. The server only needs:

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/path/to/whoop-mcp-server/dist/index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id",
        "WHOOP_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Token Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         STARTUP                                 │
├─────────────────────────────────────────────────────────────────┤
│  Claude Desktop starts → WHOOP MCP server launches              │
│                              │                                  │
│                              ▼                                  │
│                   Check for tokens.json                         │
│                        /          \                             │
│                    Found          Not Found                     │
│                      │                │                         │
│                      ▼                ▼                         │
│              Use persisted      Use env vars                    │
│                tokens          (initial setup)                  │
│                      \              /                           │
│                       ▼            ▼                            │
│                    Token loaded in memory                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       ON API CALL                               │
├─────────────────────────────────────────────────────────────────┤
│  You ask "get my recovery" → check token expiry                 │
│                              │                                  │
│                     Token expired?                              │
│                        /          \                             │
│                      YES          NO                            │
│                       │            │                            │
│                       ▼            │                            │
│              Refresh via WHOOP     │                            │
│              API (uses client      │                            │
│              credentials +         │                            │
│              refresh token)        │                            │
│                       │            │                            │
│                       ▼            │                            │
│              Save new tokens       │                            │
│              to tokens.json        │                            │
│                       \           /                             │
│                        ▼         ▼                              │
│                   Make API call with valid token                │
└─────────────────────────────────────────────────────────────────┘
```

**Key files:**
- `tokens.json` - Persisted tokens (auto-created, survives restarts)
- `dist/index.js` - The MCP server

**What's automatic:**
- Token refresh when expired
- Saving new tokens to disk
- Loading tokens on restart

**What requires manual action:**
- Initial OAuth setup (one-time)
- Re-authentication if unused for 30-90 days (refresh token expires)

## Available Tools

### `whoop_get_profile`
Get your Whoop user profile (name, email, user ID).

### `whoop_get_body_measurements`
Get your body measurements (height, weight, max heart rate).

### `whoop_get_recovery`
Get recovery data including recovery score, HRV, resting heart rate, SpO2.

**Parameters:**
- `limit` (1-25, default 7): Number of records
- `start`: Start date filter (ISO 8601)
- `end`: End date filter (ISO 8601)

### `whoop_get_sleep`
Get detailed sleep data including sleep stages, performance, and efficiency.

**Parameters:**
- `limit` (1-25, default 7): Number of records
- `start`: Start date filter (ISO 8601)
- `end`: End date filter (ISO 8601)

### `whoop_get_workouts`
Get workout data including strain, calories, heart rate zones.

**Parameters:**
- `limit` (1-25, default 10): Number of records
- `start`: Start date filter (ISO 8601)
- `end`: End date filter (ISO 8601)

### `whoop_get_cycles`
Get daily physiological cycle data (strain, calories, heart rate).

**Parameters:**
- `limit` (1-25, default 7): Number of records
- `start`: Start date filter (ISO 8601)
- `end`: End date filter (ISO 8601)

### `whoop_get_health_overview`
Get a comprehensive health overview combining recovery, sleep, and strain data with personalized recommendations.

## Example Usage with Claude

Once configured, you can ask Claude things like:

- "How's my recovery today?"
- "Show me my sleep from last week"
- "What workouts have I done recently?"
- "Give me a health overview"
- "Based on my Whoop data, should I train hard today?"
- "How has my HRV trended this week?"
- "What was my sleep quality like last night?"

## Troubleshooting

### "No tokens available" error
Run `node get-tokens.mjs` to get initial tokens, or check that `tokens.json` exists.

### "Missing WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET" error
These must always be in your Claude Desktop config - they never expire.

### "Failed to refresh token" error
Your refresh token has expired (typically after 30-90 days of non-use). Run `node get-tokens.mjs` to re-authenticate.

### No data returned
- Ensure you've worn your Whoop device and data has synced
- Check that your app has the required scopes authorized

### View current persisted tokens
```bash
cat tokens.json
```

### Force re-authentication
```bash
rm tokens.json
# Then run get-tokens.mjs or add tokens back to Claude config
```

## API Reference

This server uses the [Whoop API v2](https://developer.whoop.com/api). For more details on the data model and endpoints, see the official documentation.

## License

MIT
