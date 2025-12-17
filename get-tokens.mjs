#!/usr/bin/env node

/**
 * Whoop OAuth Token Helper
 * 
 * This script helps you get your initial access and refresh tokens from Whoop.
 * 
 * Usage:
 *   1. Run: node get-tokens.mjs
 *   2. Follow the URL in your browser
 *   3. Authorize the app
 *   4. Copy the 'code' parameter from the redirect URL
 *   5. Enter it when prompted
 *   6. Save the tokens to your Claude Desktop config
 */

import { createInterface } from 'readline';
import { promisify } from 'util';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = promisify((q, cb) => rl.question(q, (a) => cb(null, a))).bind(rl);

async function main() {
  console.log('\n🏋️ Whoop OAuth Token Helper\n');
  console.log('This script will help you get your initial access and refresh tokens.\n');

  // Get credentials
  const clientId = await question('Enter your WHOOP_CLIENT_ID: ');
  const clientSecret = await question('Enter your WHOOP_CLIENT_SECRET: ');
  const redirectUri = await question('Enter your redirect URI (e.g., http://localhost:3000/callback): ');

  // Generate authorization URL
  const scopes = [
    'offline',
    'read:recovery',
    'read:cycles',
    'read:workout',
    'read:sleep',
    'read:profile',
    'read:body_measurement',
  ].join('%20');

  const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}&state=initial_setup`;

  console.log('\n📋 Step 1: Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n📋 Step 2: Log in and authorize the app');
  console.log('📋 Step 3: After redirect, copy the "code" parameter from the URL\n');

  const authCode = await question('Enter the authorization code from the URL: ');

  console.log('\n⏳ Exchanging code for tokens...\n');

  // Exchange code for tokens
  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      redirect_uri: redirectUri.trim(),
    });

    const response = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Error: ${response.status} - ${errorText}`);
      rl.close();
      process.exit(1);
    }

    const data = await response.json();

    console.log('✅ Success! Here are your tokens:\n');
    console.log('━'.repeat(60));
    console.log(`WHOOP_ACCESS_TOKEN=${data.access_token}`);
    console.log(`WHOOP_REFRESH_TOKEN=${data.refresh_token}`);
    console.log('━'.repeat(60));

    console.log('\n📋 Option 1: Create tokens.json directly (recommended):\n');
    console.log(`cat > tokens.json << 'EOF'
{
  "accessToken": "${data.access_token}",
  "refreshToken": "${data.refresh_token}",
  "expiresAt": ${Date.now() + (data.expires_in * 1000) - 60000}
}
EOF`);

    console.log('\n📋 Option 2: Add to Claude Desktop config (for initial setup):\n');
    console.log(`{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/path/to/whoop-mcp-server/dist/index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "${clientId.trim()}",
        "WHOOP_CLIENT_SECRET": "${clientSecret.trim()}",
        "WHOOP_ACCESS_TOKEN": "${data.access_token}",
        "WHOOP_REFRESH_TOKEN": "${data.refresh_token}"
      }
    }
  }
}`);

    console.log('\n💡 After first use, the server persists tokens to tokens.json automatically.');
    console.log('   You can then remove ACCESS_TOKEN and REFRESH_TOKEN from the config.\n');
    console.log('📍 Config location:');
    console.log('   macOS: ~/Library/Application Support/Claude/claude_desktop_config.json');
    console.log('   Windows: %APPDATA%\\Claude\\claude_desktop_config.json\n');

  } catch (error) {
    console.error('❌ Error exchanging code:', error.message);
  }

  rl.close();
}

main().catch(console.error);
