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
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mask sensitive tokens for display (show first 4 and last 4 chars only)
function maskToken(token) {
  if (!token || token.length < 12) return '***masked***';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

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

    console.log('✅ Success! Tokens received.\n');

    // Write tokens directly to tokens.json with secure permissions
    const tokensPath = join(__dirname, 'tokens.json');
    const tokenData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000) - 60000
    };

    writeFileSync(tokensPath, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
    console.log(`✅ Tokens saved to: ${tokensPath}`);
    console.log('   (File permissions set to owner-only read/write)\n');

    console.log('━'.repeat(60));
    console.log(`Access Token:  ${maskToken(data.access_token)}`);
    console.log(`Refresh Token: ${maskToken(data.refresh_token)}`);
    console.log('━'.repeat(60));
    console.log('\n💡 Full tokens are saved in tokens.json (not displayed for security).\n');

    console.log('📋 Add to Claude Desktop config:\n');
    console.log(`{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["${tokensPath.replace('/tokens.json', '/dist/index.js')}"],
      "env": {
        "WHOOP_CLIENT_ID": "<your-client-id>",
        "WHOOP_CLIENT_SECRET": "<your-client-secret>"
      }
    }
  }
}`);

    console.log('\n💡 The server reads tokens from tokens.json automatically.');
    console.log('   No need to put tokens in the config - just client ID and secret.\n');
    console.log('📍 Config location:');
    console.log('   macOS: ~/Library/Application Support/Claude/claude_desktop_config.json');
    console.log('   Windows: %APPDATA%\\Claude\\claude_desktop_config.json\n');
    console.log('🔒 Security: tokens.json has restricted permissions (owner read/write only).\n');

  } catch (error) {
    console.error('❌ Error exchanging code:', error.message);
  }

  rl.close();
}

main().catch(console.error);
