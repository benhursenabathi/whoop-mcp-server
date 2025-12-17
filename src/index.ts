import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration and Types
// =============================================================================

const WHOOP_API_BASE = "https://api.prod.whoop.com/developer";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

// Token file location - same directory as the server
const TOKEN_FILE_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "tokens.json");

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// Global token storage
let tokenData: TokenData | null = null;

// =============================================================================
// Token Persistence
// =============================================================================

function loadPersistedTokens(): TokenData | null {
  try {
    if (fs.existsSync(TOKEN_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE_PATH, "utf-8"));
      console.error(`[Whoop MCP] Loaded persisted tokens from ${TOKEN_FILE_PATH}`);
      return data as TokenData;
    }
  } catch (error) {
    console.error(`[Whoop MCP] Failed to load persisted tokens: ${error}`);
  }
  return null;
}

function persistTokens(tokens: TokenData): void {
  try {
    fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(tokens, null, 2));
    console.error(`[Whoop MCP] Persisted new tokens to ${TOKEN_FILE_PATH}`);
  } catch (error) {
    console.error(`[Whoop MCP] Failed to persist tokens: ${error}`);
  }
}


// =============================================================================
// OAuth Token Management
// =============================================================================

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

function getClientCredentials(): ClientCredentials {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET environment variables"
    );
  }

  return { clientId, clientSecret };
}

function getInitialTokensFromEnv(): { accessToken: string; refreshToken: string } | null {
  const accessToken = process.env.WHOOP_ACCESS_TOKEN;
  const refreshToken = process.env.WHOOP_REFRESH_TOKEN;

  if (!accessToken || !refreshToken) {
    return null;
  }

  return { accessToken, refreshToken };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function refreshAccessToken(): Promise<string> {
  const credentials = getClientCredentials();

  // Use the current refresh token from memory (must be loaded before calling this)
  if (!tokenData?.refreshToken) {
    throw new Error("No refresh token available. Please re-authenticate.");
  }

  console.error(`[Whoop MCP] Refreshing access token...`);

  const refreshParams = {
    grant_type: "refresh_token",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: "offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement",
    refresh_token: tokenData.refreshToken,
  };

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(refreshParams),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as TokenResponse;
  
  // Update in-memory tokens
  tokenData = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - 60000, // Refresh 1 min before expiry
  };

  // CRITICAL: Persist to disk so they survive restarts
  persistTokens(tokenData);
  
  console.error(`[Whoop MCP] Token refreshed successfully. New token expires at ${new Date(tokenData.expiresAt).toISOString()}`);

  return tokenData.accessToken;
}

async function getValidAccessToken(): Promise<string> {
  // Try to load persisted tokens first (survives restarts)
  if (!tokenData) {
    tokenData = loadPersistedTokens();
    if (tokenData) {
      console.error(`[Whoop MCP] Using persisted tokens (expires: ${new Date(tokenData.expiresAt).toISOString()})`);
    }
  }

  // If still no tokens, try to initialize from env vars (first-time setup)
  if (!tokenData) {
    const envTokens = getInitialTokensFromEnv();
    if (envTokens) {
      console.error(`[Whoop MCP] No persisted tokens found, using env vars for initial setup`);
      tokenData = {
        accessToken: envTokens.accessToken,
        refreshToken: envTokens.refreshToken,
        expiresAt: Date.now() + 3600000, // Assume 1 hour validity initially
      };
      // Persist immediately so future restarts use persisted tokens
      persistTokens(tokenData);
    } else {
      throw new Error(
        "No tokens available. Either provide WHOOP_ACCESS_TOKEN and WHOOP_REFRESH_TOKEN env vars, " +
        "or ensure tokens.json exists with valid tokens."
      );
    }
  }

  // Check if token is expired or about to expire
  if (Date.now() >= tokenData.expiresAt) {
    console.error(`[Whoop MCP] Token expired, refreshing...`);
    return await refreshAccessToken();
  }

  return tokenData.accessToken;
}

// =============================================================================
// API Request Helper
// =============================================================================

async function makeWhoopRequest<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<T> {
  const accessToken = await getValidAccessToken();
  
  let url = `${WHOOP_API_BASE}${endpoint}`;
  if (params) {
    const queryString = new URLSearchParams(params).toString();
    url = `${url}?${queryString}`;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    // Token expired, try refresh
    console.error(`[Whoop MCP] Got 401, attempting token refresh...`);
    const newToken = await refreshAccessToken();
    const retryResponse = await fetch(url, {
      headers: {
        Authorization: `Bearer ${newToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!retryResponse.ok) {
      const errorText = await retryResponse.text();
      throw new Error(`Whoop API error: ${retryResponse.status} - ${errorText}`);
    }

    return (await retryResponse.json()) as T;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whoop API error: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as T;
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatDuration(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getRecoveryZone(score: number): string {
  if (score >= 67) return "🟢 Green (Optimal)";
  if (score >= 34) return "🟡 Yellow (Moderate)";
  return "🔴 Red (Low)";
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new McpServer({
  name: "whoop-mcp-server",
  version: "1.1.0",
});

// =============================================================================
// Tool: Get User Profile
// =============================================================================

server.registerTool(
  "whoop_get_profile",
  {
    title: "Get Whoop User Profile",
    description: `Retrieves basic profile information for the authenticated Whoop user.

Returns:
- user_id: Whoop user ID
- email: User's email address
- first_name: User's first name
- last_name: User's last name

Use this to identify the user and personalize responses.`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const profile = await makeWhoopRequest<{
        user_id: number;
        email: string;
        first_name: string;
        last_name: string;
      }>("/v2/user/profile/basic");

      return {
        content: [
          {
            type: "text",
            text: `👤 **Whoop Profile**\n\nName: ${profile.first_name} ${profile.last_name}\nEmail: ${profile.email}\nUser ID: ${profile.user_id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching profile: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Tool: Get Body Measurements
// =============================================================================

server.registerTool(
  "whoop_get_body_measurements",
  {
    title: "Get Body Measurements",
    description: `Retrieves body measurements for the authenticated Whoop user.

Returns:
- height_meter: Height in meters
- weight_kilogram: Weight in kilograms
- max_heart_rate: Maximum heart rate

Useful for calculating calories burned and personalizing workout recommendations.`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const measurements = await makeWhoopRequest<{
        height_meter: number;
        weight_kilogram: number;
        max_heart_rate: number;
      }>("/v2/user/measurement/body");

      const heightCm = Math.round(measurements.height_meter * 100);
      const heightFeet = Math.floor(heightCm / 30.48);
      const heightInches = Math.round((heightCm % 30.48) / 2.54);
      const weightLbs = Math.round(measurements.weight_kilogram * 2.205);

      return {
        content: [
          {
            type: "text",
            text: `📏 **Body Measurements**\n\nHeight: ${heightCm}cm (${heightFeet}'${heightInches}")\nWeight: ${measurements.weight_kilogram}kg (${weightLbs}lbs)\nMax Heart Rate: ${measurements.max_heart_rate} bpm`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching body measurements: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Tool: Get Recovery Data
// =============================================================================

const RecoveryInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(7)
    .describe("Number of recovery records to fetch (1-25, default: 7)"),
  start: z
    .string()
    .optional()
    .describe("Start date filter (ISO 8601 format, e.g., 2024-01-01T00:00:00Z)"),
  end: z
    .string()
    .optional()
    .describe("End date filter (ISO 8601 format)"),
}).strict();

server.registerTool(
  "whoop_get_recovery",
  {
    title: "Get Recovery Data",
    description: `Retrieves recovery data from Whoop including recovery score, HRV, resting heart rate, and SpO2.

Recovery score indicates how ready your body is for strain:
- 67-100% (Green): Optimal recovery, ready for high strain
- 34-66% (Yellow): Moderate recovery, be mindful of strain
- 0-33% (Red): Low recovery, prioritize rest

Parameters:
- limit: Number of records (1-25, default: 7)
- start: Filter recoveries after this date (ISO 8601)
- end: Filter recoveries before this date (ISO 8601)

Returns for each recovery:
- recovery_score: Overall recovery percentage
- hrv_rmssd_milli: Heart rate variability (ms)
- resting_heart_rate: Resting heart rate (bpm)
- spo2_percentage: Blood oxygen saturation
- skin_temp_celsius: Skin temperature`,
    inputSchema: RecoveryInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const queryParams: Record<string, string> = {
        limit: params.limit.toString(),
      };
      if (params.start) queryParams.start = params.start;
      if (params.end) queryParams.end = params.end;

      const data = await makeWhoopRequest<{
        records: Array<{
          cycle_id: number;
          sleep_id: string;
          user_id: number;
          created_at: string;
          updated_at: string;
          score_state: string;
          score?: {
            user_calibrating: boolean;
            recovery_score: number;
            resting_heart_rate: number;
            hrv_rmssd_milli: number;
            spo2_percentage?: number;
            skin_temp_celsius?: number;
          };
        }>;
        next_token?: string;
      }>("/v2/recovery", queryParams);

      if (!data.records || data.records.length === 0) {
        return {
          content: [{ type: "text", text: "No recovery data found for the specified period." }],
        };
      }

      const recoveryText = data.records
        .filter((r) => r.score)
        .map((r) => {
          const score = r.score!;
          return `📊 **${formatDate(r.created_at)}**
   Recovery: ${score.recovery_score}% ${getRecoveryZone(score.recovery_score)}
   HRV: ${score.hrv_rmssd_milli.toFixed(1)}ms
   Resting HR: ${score.resting_heart_rate} bpm
   ${score.spo2_percentage ? `SpO2: ${score.spo2_percentage.toFixed(1)}%` : ""}
   ${score.skin_temp_celsius ? `Skin Temp: ${score.skin_temp_celsius.toFixed(1)}°C` : ""}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `💚 **Recovery Data (Last ${data.records.length} records)**\n\n${recoveryText}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching recovery data: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Tool: Get Sleep Data
// =============================================================================

const SleepInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(7)
    .describe("Number of sleep records to fetch (1-25, default: 7)"),
  start: z
    .string()
    .optional()
    .describe("Start date filter (ISO 8601 format)"),
  end: z
    .string()
    .optional()
    .describe("End date filter (ISO 8601 format)"),
}).strict();

server.registerTool(
  "whoop_get_sleep",
  {
    title: "Get Sleep Data",
    description: `Retrieves detailed sleep data from Whoop including sleep stages, performance, and respiratory rate.

Parameters:
- limit: Number of records (1-25, default: 7)
- start: Filter sleeps after this date (ISO 8601)
- end: Filter sleeps before this date (ISO 8601)

Returns for each sleep:
- Sleep stages: Light, REM, Deep (SWS), Awake time
- sleep_performance_percentage: How well you met your sleep need
- sleep_efficiency_percentage: Time asleep vs time in bed
- sleep_consistency_percentage: Regularity of sleep schedule
- respiratory_rate: Breaths per minute
- sleep_needed: Baseline need plus adjustments for strain/debt`,
    inputSchema: SleepInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const queryParams: Record<string, string> = {
        limit: params.limit.toString(),
      };
      if (params.start) queryParams.start = params.start;
      if (params.end) queryParams.end = params.end;

      const data = await makeWhoopRequest<{
        records: Array<{
          id: string;
          cycle_id: number;
          user_id: number;
          created_at: string;
          start: string;
          end: string;
          nap: boolean;
          score_state: string;
          score?: {
            stage_summary: {
              total_in_bed_time_milli: number;
              total_awake_time_milli: number;
              total_light_sleep_time_milli: number;
              total_slow_wave_sleep_time_milli: number;
              total_rem_sleep_time_milli: number;
              sleep_cycle_count: number;
              disturbance_count: number;
            };
            sleep_needed: {
              baseline_milli: number;
              need_from_sleep_debt_milli: number;
              need_from_recent_strain_milli: number;
              need_from_recent_nap_milli: number;
            };
            respiratory_rate: number;
            sleep_performance_percentage: number;
            sleep_consistency_percentage: number;
            sleep_efficiency_percentage: number;
          };
        }>;
        next_token?: string;
      }>("/v2/activity/sleep", queryParams);

      if (!data.records || data.records.length === 0) {
        return {
          content: [{ type: "text", text: "No sleep data found for the specified period." }],
        };
      }

      const sleepText = data.records
        .filter((s) => s.score && !s.nap)
        .map((s) => {
          const score = s.score!;
          const stages = score.stage_summary;
          const totalSleep =
            stages.total_light_sleep_time_milli +
            stages.total_slow_wave_sleep_time_milli +
            stages.total_rem_sleep_time_milli;

          return `🌙 **${formatDate(s.start)}**
   Total Sleep: ${formatDuration(totalSleep)}
   Performance: ${score.sleep_performance_percentage}%
   Efficiency: ${score.sleep_efficiency_percentage.toFixed(1)}%
   Consistency: ${score.sleep_consistency_percentage}%
   
   Sleep Stages:
   • Light: ${formatDuration(stages.total_light_sleep_time_milli)}
   • Deep (SWS): ${formatDuration(stages.total_slow_wave_sleep_time_milli)}
   • REM: ${formatDuration(stages.total_rem_sleep_time_milli)}
   • Awake: ${formatDuration(stages.total_awake_time_milli)}
   
   Respiratory Rate: ${score.respiratory_rate.toFixed(1)} breaths/min
   Disturbances: ${stages.disturbance_count}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `😴 **Sleep Data (Last ${data.records.filter((s) => !s.nap).length} nights)**\n\n${sleepText}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching sleep data: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Tool: Get Workout Data
// =============================================================================

const WorkoutInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10)
    .describe("Number of workout records to fetch (1-25, default: 10)"),
  start: z
    .string()
    .optional()
    .describe("Start date filter (ISO 8601 format)"),
  end: z
    .string()
    .optional()
    .describe("End date filter (ISO 8601 format)"),
}).strict();

server.registerTool(
  "whoop_get_workouts",
  {
    title: "Get Workout Data",
    description: `Retrieves workout data from Whoop including strain, heart rate zones, calories, and distance.

Strain is measured on a 0-21 scale:
- 0-10: Light activity
- 10-14: Moderate activity
- 14-18: High strain (strenuous)
- 18-21: All out (maximal effort)

Parameters:
- limit: Number of records (1-25, default: 10)
- start: Filter workouts after this date (ISO 8601)
- end: Filter workouts before this date (ISO 8601)

Returns for each workout:
- sport_name: Type of activity
- strain: Workout strain score (0-21)
- kilojoule: Energy burned
- average/max_heart_rate: Heart rate data
- distance_meter: Distance covered (if applicable)
- zone_durations: Time spent in each HR zone`,
    inputSchema: WorkoutInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const queryParams: Record<string, string> = {
        limit: params.limit.toString(),
      };
      if (params.start) queryParams.start = params.start;
      if (params.end) queryParams.end = params.end;

      const data = await makeWhoopRequest<{
        records: Array<{
          id: string;
          user_id: number;
          created_at: string;
          start: string;
          end: string;
          sport_name?: string;
          sport_id: number;
          score_state: string;
          score?: {
            strain: number;
            average_heart_rate: number;
            max_heart_rate: number;
            kilojoule: number;
            percent_recorded: number;
            distance_meter?: number;
            altitude_gain_meter?: number;
            zone_durations?: {
              zone_zero_milli: number;
              zone_one_milli: number;
              zone_two_milli: number;
              zone_three_milli: number;
              zone_four_milli: number;
              zone_five_milli: number;
            };
          };
        }>;
        next_token?: string;
      }>("/v2/activity/workout", queryParams);

      if (!data.records || data.records.length === 0) {
        return {
          content: [{ type: "text", text: "No workout data found for the specified period." }],
        };
      }

      const workoutText = data.records
        .filter((w) => w.score)
        .map((w) => {
          const score = w.score!;
          const calories = Math.round(score.kilojoule / 4.184);
          const distanceKm = score.distance_meter
            ? (score.distance_meter / 1000).toFixed(2)
            : null;

          return `🏋️ **${w.sport_name || "Activity"} - ${formatDate(w.start)}**
   Strain: ${score.strain.toFixed(1)}/21
   Calories: ${calories} kcal
   Avg HR: ${score.average_heart_rate} bpm | Max HR: ${score.max_heart_rate} bpm
   ${distanceKm ? `Distance: ${distanceKm} km` : ""}
   ${score.altitude_gain_meter ? `Elevation Gain: ${score.altitude_gain_meter.toFixed(0)}m` : ""}`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `💪 **Workout Data (Last ${data.records.length} workouts)**\n\n${workoutText}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching workout data: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Tool: Get Cycles (Strain) Data
// =============================================================================

const CycleInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(7)
    .describe("Number of cycle records to fetch (1-25, default: 7)"),
  start: z
    .string()
    .optional()
    .describe("Start date filter (ISO 8601 format)"),
  end: z
    .string()
    .optional()
    .describe("End date filter (ISO 8601 format)"),
}).strict();

server.registerTool(
  "whoop_get_cycles",
  {
    title: "Get Daily Strain Cycles",
    description: `Retrieves physiological cycle (day) data from Whoop including daily strain, calories, and heart rate.

A cycle represents a physiological day (wake to wake), not a calendar day.

Day Strain is cumulative and measured on a 0-21 scale:
- 0-10: Light day
- 10-14: Moderate day  
- 14-18: Strenuous day
- 18-21: All out day

Parameters:
- limit: Number of records (1-25, default: 7)
- start: Filter cycles after this date (ISO 8601)
- end: Filter cycles before this date (ISO 8601)

Returns for each cycle:
- strain: Daily strain score (0-21)
- kilojoule: Total energy expenditure
- average/max_heart_rate: Heart rate summary`,
    inputSchema: CycleInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const queryParams: Record<string, string> = {
        limit: params.limit.toString(),
      };
      if (params.start) queryParams.start = params.start;
      if (params.end) queryParams.end = params.end;

      const data = await makeWhoopRequest<{
        records: Array<{
          id: number;
          user_id: number;
          created_at: string;
          start: string;
          end?: string;
          score_state: string;
          score?: {
            strain: number;
            kilojoule: number;
            average_heart_rate: number;
            max_heart_rate: number;
          };
        }>;
        next_token?: string;
      }>("/v2/cycle", queryParams);

      if (!data.records || data.records.length === 0) {
        return {
          content: [{ type: "text", text: "No cycle data found for the specified period." }],
        };
      }

      const cycleText = data.records
        .filter((c) => c.score)
        .map((c) => {
          const score = c.score!;
          const calories = Math.round(score.kilojoule / 4.184);

          return `📅 **${formatDate(c.start)}**
   Day Strain: ${score.strain.toFixed(1)}/21
   Calories: ${calories} kcal
   Avg HR: ${score.average_heart_rate} bpm | Max HR: ${score.max_heart_rate} bpm`;
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `⚡ **Daily Strain Data (Last ${data.records.length} days)**\n\n${cycleText}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching cycle data: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Tool: Get Health Overview (Combined Data)
// =============================================================================

server.registerTool(
  "whoop_get_health_overview",
  {
    title: "Get Health Overview",
    description: `Gets a comprehensive health overview combining your latest recovery, sleep, and strain data.

This is the best tool to use when you want a quick summary of current health status.

Returns:
- Latest recovery score and metrics (HRV, RHR, SpO2)
- Last night's sleep data and performance
- Today's/yesterday's strain
- Personalized recommendations based on recovery status

Use this for:
- Morning check-ins on readiness
- Quick health status updates
- Deciding workout intensity
- Understanding overall health trends`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      // Fetch all data in parallel
      const [recoveryData, sleepData, cycleData] = await Promise.all([
        makeWhoopRequest<{
          records: Array<{
            created_at: string;
            score_state: string;
            score?: {
              recovery_score: number;
              resting_heart_rate: number;
              hrv_rmssd_milli: number;
              spo2_percentage?: number;
              skin_temp_celsius?: number;
            };
          }>;
        }>("/v2/recovery", { limit: "1" }),
        makeWhoopRequest<{
          records: Array<{
            start: string;
            nap: boolean;
            score_state: string;
            score?: {
              stage_summary: {
                total_light_sleep_time_milli: number;
                total_slow_wave_sleep_time_milli: number;
                total_rem_sleep_time_milli: number;
                total_awake_time_milli: number;
              };
              sleep_performance_percentage: number;
              sleep_efficiency_percentage: number;
              respiratory_rate: number;
            };
          }>;
        }>("/v2/activity/sleep", { limit: "3" }),
        makeWhoopRequest<{
          records: Array<{
            start: string;
            score_state: string;
            score?: {
              strain: number;
              kilojoule: number;
              average_heart_rate: number;
            };
          }>;
        }>("/v2/cycle", { limit: "1" }),
      ]);

      let output = "# 🏥 Health Overview\n\n";

      // Recovery section
      const latestRecovery = recoveryData.records?.[0];
      if (latestRecovery?.score) {
        const r = latestRecovery.score;
        output += `## 💚 Recovery Status\n`;
        output += `**Score: ${r.recovery_score}%** ${getRecoveryZone(r.recovery_score)}\n\n`;
        output += `- HRV: ${r.hrv_rmssd_milli.toFixed(1)} ms\n`;
        output += `- Resting HR: ${r.resting_heart_rate} bpm\n`;
        if (r.spo2_percentage) output += `- SpO2: ${r.spo2_percentage.toFixed(1)}%\n`;
        if (r.skin_temp_celsius) output += `- Skin Temp: ${r.skin_temp_celsius.toFixed(1)}°C\n`;
        output += "\n";
      }

      // Sleep section
      const latestSleep = sleepData.records?.find((s) => !s.nap);
      if (latestSleep?.score) {
        const s = latestSleep.score;
        const stages = s.stage_summary;
        const totalSleep =
          stages.total_light_sleep_time_milli +
          stages.total_slow_wave_sleep_time_milli +
          stages.total_rem_sleep_time_milli;

        output += `## 😴 Last Night's Sleep\n`;
        output += `**Total: ${formatDuration(totalSleep)}** | Performance: ${s.sleep_performance_percentage}%\n\n`;
        output += `- Deep Sleep: ${formatDuration(stages.total_slow_wave_sleep_time_milli)}\n`;
        output += `- REM: ${formatDuration(stages.total_rem_sleep_time_milli)}\n`;
        output += `- Efficiency: ${s.sleep_efficiency_percentage.toFixed(1)}%\n`;
        output += "\n";
      }

      // Strain section
      const latestCycle = cycleData.records?.[0];
      if (latestCycle?.score) {
        const c = latestCycle.score;
        const calories = Math.round(c.kilojoule / 4.184);
        output += `## ⚡ Current Day Strain\n`;
        output += `**Strain: ${c.strain.toFixed(1)}/21** | Calories: ${calories} kcal\n\n`;
      }

      // Recommendations based on recovery
      if (latestRecovery?.score) {
        const recoveryScore = latestRecovery.score.recovery_score;
        output += `## 💡 Recommendations\n`;
        if (recoveryScore >= 67) {
          output += `Your body is well-recovered! Great day for:\n`;
          output += `- High-intensity training\n`;
          output += `- Challenging workouts\n`;
          output += `- Building fitness\n`;
        } else if (recoveryScore >= 34) {
          output += `Moderate recovery - consider:\n`;
          output += `- Moderate intensity exercise\n`;
          output += `- Active recovery activities\n`;
          output += `- Being mindful of total strain\n`;
        } else {
          output += `Low recovery - prioritize:\n`;
          output += `- Rest and recovery\n`;
          output += `- Light movement only (walking, stretching)\n`;
          output += `- Earlier bedtime tonight\n`;
          output += `- Stress reduction\n`;
        }
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching health overview: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Whoop MCP Server v1.1.0 running on stdio (with token persistence)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
