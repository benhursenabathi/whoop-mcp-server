# How to Use the WHOOP MCP Server

A step-by-step guide to get your WHOOP data working with Claude Desktop.

## Prerequisites

- A WHOOP device with an active membership
- [Node.js 18+](https://nodejs.org/) installed
- [Claude Desktop](https://claude.ai/download) installed

## Step 1: Create a WHOOP Developer App

1. Go to [developer-dashboard.whoop.com](https://developer-dashboard.whoop.com)
2. Sign in with your WHOOP account
3. Click **Create New App**
4. Fill in the details:
   - **App Name**: Anything you want (e.g., "My Claude Integration")
   - **Redirect URI**: `http://localhost:8080/callback`
5. Save your **Client ID** and **Client Secret** - you'll need these later
6. Under **Scopes**, enable:
   - `read:recovery`
   - `read:cycles`
   - `read:workout`
   - `read:sleep`
   - `read:profile`
   - `read:body_measurement`
   - `offline`

## Step 2: Install the MCP Server

Open your terminal and run:

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/whoop-mcp-server.git

# Enter the directory
cd whoop-mcp-server

# Install dependencies
npm install

# Build the server
npm run build
```

Note the full path to this folder - you'll need it for Step 4.

## Step 3: Get Your Initial Tokens

Run the token helper:

```bash
node get-tokens.mjs
```

Follow the prompts:
1. Enter your **Client ID** (from Step 1)
2. Enter your **Client Secret** (from Step 1)
3. Enter redirect URI: `http://localhost:8080/callback`
4. Open the URL it gives you in your browser
5. Log in to WHOOP and authorize the app
6. You'll be redirected to a page that won't load - that's expected
7. Copy the `code` parameter from the URL bar (the text after `?code=` and before `&`)
8. Paste it back in the terminal

The script will automatically save your tokens to `tokens.json` with secure permissions.

## Step 4: Configure Claude Desktop

1. Open Claude Desktop's config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the WHOOP server to `mcpServers` (create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/FULL/PATH/TO/whoop-mcp-server/dist/index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id-from-step-1",
        "WHOOP_CLIENT_SECRET": "your-client-secret-from-step-1"
      }
    }
  }
}
```

**Important**: Replace `/FULL/PATH/TO/` with the actual path to where you cloned the repo.

The server reads tokens from `tokens.json` automatically - you only need client ID and secret in the config.

## Step 5: Restart Claude Desktop

Quit Claude Desktop completely and reopen it.

## Step 6: Test It

Ask Claude something like:
- "How's my recovery today?"
- "Show me my sleep from last week"
- "Give me a health overview"

If it works, you're done! The server will automatically refresh and persist tokens going forward.

---

## Troubleshooting

### "Cannot find module" error
Make sure you ran `npm run build` and the path in your config is correct.

### "Missing WHOOP_CLIENT_ID" error
Check your Claude Desktop config has the correct environment variables.

### "Failed to refresh token" error
Your refresh token expired. Run `node get-tokens.mjs` again to get new tokens.

### Claude doesn't see the WHOOP tools
Restart Claude Desktop completely (quit and reopen, not just close the window).

### Still stuck?
See [TOKEN_EXPIRY_FIX.md](./TOKEN_EXPIRY_FIX.md) for more troubleshooting tips.
