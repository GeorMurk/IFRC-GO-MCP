/**
 * HOTOSM Raw Data API MCP Server
 *
 * REQUIREMENTS:
 * 1. Optionally create a .env file with: HOTOSM_ACCESS_TOKEN=your_token
 *    (most read endpoints are public; token required for writes and some admin ops)
 * 2. Run 'node server.js'
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, ".env"),
  path.resolve(__dirname, "..", ".env"),
];

for (const envPath of [...new Set(envPaths)]) {
  if (!fs.existsSync(envPath)) continue;
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) return;
    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) return;
    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

const HOTOSM_ACCESS_TOKEN = process.env.HOTOSM_ACCESS_TOKEN || "";
const BASE_URL = "https://api-prod.raw-data.hotosm.org/v1";

let needsInstall = false;
try {
  require.resolve("@modelcontextprotocol/sdk/server/index.js");
  require.resolve("@modelcontextprotocol/sdk/server/stdio.js");
  require.resolve("@modelcontextprotocol/sdk/types.js");
  require.resolve("axios");
} catch (e) {
  needsInstall = true;
}

if (needsInstall) {
  console.log("Installing dependencies (@modelcontextprotocol/sdk, axios)...");
  try {
    execSync("npm install @modelcontextprotocol/sdk axios", { stdio: "inherit" });
    console.log("Dependencies installed. Restarting server...\n");
    execFileSync(process.execPath, process.argv.slice(1), { stdio: "inherit" });
    process.exit(0);
  } catch (err) {
    console.error("Failed to install dependencies.");
    process.exit(1);
  }
}

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const axios = require("axios");

const server = new Server(
  { name: "hotosm-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

async function callApi(endpoint, { method = "GET", params = {}, body = null, requiresAuth = false } = {}) {
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)
  );
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (HOTOSM_ACCESS_TOKEN) {
    headers["access-token"] = HOTOSM_ACCESS_TOKEN;
  } else if (requiresAuth) {
    throw new Error("HOTOSM_ACCESS_TOKEN is required for this operation. Please add it to your .env file.");
  }
  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      params: cleanParams,
      data: body || undefined,
      headers,
      timeout: 30000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`API Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Request failed: ${error.message}`);
  }
}

// --- TOOL DEFINITIONS ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [

      // ── STATUS ──────────────────────────────────────────────────────────────
      {
        name: "get_database_status",
        description: "Check when the OSM database was last updated. (Docs: GET /status/)",
        inputSchema: { type: "object", properties: {} },
      },

      // ── COUNTRIES ────────────────────────────────────────────────────────────
      {
        name: "list_countries",
        description: "Get a list of countries supported by the HOTOSM Raw Data API. (Docs: GET /countries/)",
        inputSchema: {
          type: "object",
          properties: {
            q: { type: "string", description: "Optional search query to filter countries by name" },
          },
        },
      },
      {
        name: "get_country",
        description: "Get details for a specific country by its ID. (Docs: GET /countries/{cid}/)",
        inputSchema: {
          type: "object",
          properties: {
            cid: { type: "integer", description: "Country ID" },
          },
          required: ["cid"],
        },
      },

      // ── OSM FEATURES ─────────────────────────────────────────────────────────
      {
        name: "get_osm_feature",
        description: "Retrieve an OSM feature by its OSM ID. (Docs: GET /osm_id/)",
        inputSchema: {
          type: "object",
          properties: {
            osm_id: { type: "integer", description: "The OpenStreetMap feature ID" },
          },
          required: ["osm_id"],
        },
      },

      // ── SNAPSHOT (RAW DATA EXPORT) ────────────────────────────────────────────
      {
        name: "request_snapshot",
        description: "Request an OSM data export (snapshot) for a given geometry. Returns a task ID to track the async export. Supports filtering by geometry types and OSM tags. (Docs: POST /snapshot/)",
        inputSchema: {
          type: "object",
          properties: {
            geometry: {
              type: "object",
              description: "GeoJSON geometry (Polygon, MultiPolygon, Feature, or FeatureCollection) defining the area to export",
            },
            outputType: {
              type: "string",
              description: "Output format: geojson, shp, fgb, mbtiles, kml, csv, sql (default: geojson)",
              enum: ["geojson", "shp", "fgb", "mbtiles", "kml", "csv", "sql"],
            },
            geometryType: {
              type: "array",
              items: { type: "string", enum: ["point", "line", "polygon"] },
              description: "Filter by geometry types to include in the export",
            },
            filters: {
              type: "object",
              description: "Tag/attribute filters. Example: {\"tags\":{\"all_geometry\":{\"join_or\":{\"building\":[]}}},\"attributes\":{\"all_geometry\":[\"name\"]}}",
            },
            fileName: { type: "string", description: "Custom file name for the export" },
            centroid: { type: "boolean", description: "Export centroids of features instead of full geometries (default: false)" },
            useStWithin: { type: "boolean", description: "Use ST_WITHIN instead of intersection (default: true)" },
            includeStatsHtml: { type: "boolean", description: "Include HTML stats report with building/road counts (default: false)" },
            includeTranslit: { type: "boolean", description: "Include transliterations in output (default: false)" },
            minZoom: { type: "integer", description: "Minimum zoom level (only for mbtiles output)" },
            maxZoom: { type: "integer", description: "Maximum zoom level (only for mbtiles output)" },
          },
          required: ["geometry"],
        },
      },
      {
        name: "request_snapshot_plain",
        description: "Get an immediate plain GeoJSON response for small areas (≤30 sq km). Unlike request_snapshot, returns data directly without a task queue. (Docs: POST /snapshot/plain/)",
        inputSchema: {
          type: "object",
          properties: {
            geometry: {
              type: "object",
              description: "GeoJSON geometry (Polygon, MultiPolygon, Feature, or FeatureCollection) — must be ≤30 sq km",
            },
            outputType: {
              type: "string",
              description: "Output format (default: geojson)",
              enum: ["geojson", "shp", "fgb", "mbtiles", "kml", "csv", "sql"],
            },
            geometryType: {
              type: "array",
              items: { type: "string", enum: ["point", "line", "polygon"] },
              description: "Filter by geometry types",
            },
            filters: {
              type: "object",
              description: "Tag/attribute filters for OSM data",
            },
            centroid: { type: "boolean", description: "Export centroids (default: false)" },
          },
          required: ["geometry"],
        },
      },

      // ── CUSTOM EXPORT ─────────────────────────────────────────────────────────
      {
        name: "request_custom_snapshot",
        description: "Request a custom export with dynamic categories (e.g. Roads, Buildings) and optional HDX upload. Returns a task ID. (Docs: POST /custom/snapshot/)",
        inputSchema: {
          type: "object",
          properties: {
            categories: {
              type: "array",
              description: "List of category definitions. Example: [{\"Roads\":{\"formats\":[\"geojson\"],\"types\":[\"lines\"],\"select\":[\"name\",\"highway\"],\"where\":\"tags['highway'] IS NOT NULL\"}}]",
              items: { type: "object" },
            },
            geometry: {
              type: "object",
              description: "GeoJSON geometry for the export area",
            },
            iso3: { type: "string", description: "ISO3 country code (e.g. 'KEN')" },
            hdxUpload: { type: "boolean", description: "Upload result to HDX (default: false)" },
            dataset: {
              type: "object",
              description: "HDX dataset config: {dataset_folder, dataset_prefix, dataset_title}",
            },
            includeStats: { type: "boolean", description: "Include stats JSON file (GeoJSON only, default: false)" },
            includeStatsHtml: { type: "boolean", description: "Include stats HTML file (GeoJSON only, default: false)" },
            includeTranslit: { type: "boolean", description: "Include transliterations (GeoJSON only, default: false)" },
          },
          required: ["categories"],
        },
      },
      {
        name: "request_custom_snapshot_yaml",
        description: "Request a custom export using a YAML configuration string. (Docs: POST /custom/snapshot/yaml/)",
        inputSchema: {
          type: "object",
          properties: {
            yaml_config: { type: "string", description: "YAML-formatted export configuration string" },
          },
          required: ["yaml_config"],
        },
      },

      // ── TASK MANAGEMENT ──────────────────────────────────────────────────────
      {
        name: "get_task_status",
        description: "Check the status and result of an async export task by its task ID. (Docs: GET /tasks/status/{task_id}/)",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID returned from a snapshot or custom export request" },
            only_args: { type: "boolean", description: "Return only task arguments without result (default: false)" },
          },
          required: ["task_id"],
        },
      },
      {
        name: "revoke_task",
        description: "Cancel and revoke a running or queued export task. Requires authentication. (Docs: GET /tasks/revoke/{task_id}/)",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID to cancel" },
          },
          required: ["task_id"],
        },
      },
      {
        name: "get_task_queue_info",
        description: "Get general task queue status and worker information. (Docs: GET /tasks/queue/)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_task_queue_details",
        description: "Get detailed information about a specific task queue. (Docs: GET /tasks/queue/details/{queue_name}/)",
        inputSchema: {
          type: "object",
          properties: {
            queue_name: { type: "string", description: "Queue name (e.g. 'raw_ondemand')" },
            args: { type: "boolean", description: "Include task arguments in response (default: false)" },
          },
          required: ["queue_name"],
        },
      },
      {
        name: "ping_workers",
        description: "Ping available Celery workers to verify they are online. (Docs: GET /tasks/ping/)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "inspect_workers",
        description: "Inspect active tasks currently running on workers. (Docs: GET /tasks/inspect/)",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "boolean", description: "Return summary view only (default: true)" },
          },
        },
      },

      // ── METRICS ───────────────────────────────────────────────────────────────
      {
        name: "get_metrics_summary",
        description: "Get aggregated download/upload statistics grouped by time period. Requires authentication. (Docs: GET /metrics/summary)",
        inputSchema: {
          type: "object",
          properties: {
            start_date: { type: "string", description: "Start date (YYYY-MM-DD) — required" },
            end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
            group_by: {
              type: "string",
              description: "Time grouping: day, month, quarter, year",
              enum: ["day", "month", "quarter", "year"],
            },
            folders: { type: "string", description: "Filter by folder names" },
            include_locations: { type: "boolean", description: "Include geographic breakdown (default: false)" },
            include_referrers: { type: "boolean", description: "Include referrer breakdown (default: false)" },
          },
          required: ["start_date"],
        },
      },
      {
        name: "get_meta_downloads",
        description: "Get paginated download counts per file key. Requires authentication. (Docs: GET /metrics/meta-downloads)",
        inputSchema: {
          type: "object",
          properties: {
            start_date: { type: "string", description: "Start date (YYYY-MM-DD) — required" },
            end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
            group_by: { type: "string", description: "Time grouping: day, month, quarter, year" },
            key_prefixes: { type: "string", description: "Filter by S3 key prefix" },
            limit: { type: "integer", description: "Max results (max 500, default 100)" },
            offset: { type: "integer", description: "Pagination offset (default 0)" },
          },
          required: ["start_date"],
        },
      },

      // ── S3 FILES ──────────────────────────────────────────────────────────────
      {
        name: "list_s3_files",
        description: "List exported files stored in S3. (Docs: GET /s3/files/)",
        inputSchema: {
          type: "object",
          properties: {
            folder: { type: "string", description: "S3 folder path to list (default: '/HDX')" },
            prettify: { type: "boolean", description: "Return prettified file listing (default: false)" },
          },
        },
      },
      {
        name: "get_s3_file",
        description: "Get a presigned download URL or metadata for an S3 exported file. (Docs: GET /s3/get/{file_path})",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "S3 file path (e.g. 'HDX/hotosm_ken_roads.geojson.zip')" },
            expiry: { type: "integer", description: "URL expiry in seconds (default 3600, max 302400)" },
            read_meta: { type: "boolean", description: "Include file metadata (default: true)" },
          },
          required: ["file_path"],
        },
      },

      // ── CRON JOBS ─────────────────────────────────────────────────────────────
      {
        name: "list_cron_jobs",
        description: "List scheduled recurring export jobs. (Docs: GET /cron/)",
        inputSchema: {
          type: "object",
          properties: {
            skip: { type: "integer", description: "Pagination offset (default 0)" },
            limit: { type: "integer", description: "Max results (default 10)" },
          },
        },
      },
      {
        name: "search_cron_jobs",
        description: "Search scheduled export jobs by dataset title. (Docs: GET /cron/search/)",
        inputSchema: {
          type: "object",
          properties: {
            dataset_title: { type: "string", description: "Dataset title to search for" },
            skip: { type: "integer", description: "Pagination offset (default 0)" },
            limit: { type: "integer", description: "Max results (default 10)" },
          },
          required: ["dataset_title"],
        },
      },
      {
        name: "get_cron_job",
        description: "Get a specific scheduled export job by ID. (Docs: GET /cron/{cron_id})",
        inputSchema: {
          type: "object",
          properties: {
            cron_id: { type: "integer", description: "Cron job ID" },
          },
          required: ["cron_id"],
        },
      },

      // ── AUTH ──────────────────────────────────────────────────────────────────
      {
        name: "get_login_url",
        description: "Get the OAuth2 login URL for authenticating with OpenStreetMap. (Docs: GET /auth/login/)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_my_profile",
        description: "Get the authenticated user's profile from OSM. Requires authentication. (Docs: GET /auth/me/)",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

// --- TOOL EXECUTION ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;

    switch (name) {

      // STATUS
      case "get_database_status":
        result = await callApi("/status/");
        break;

      // COUNTRIES
      case "list_countries":
        result = await callApi("/countries/", { params: { q: args.q } });
        break;
      case "get_country":
        result = await callApi(`/countries/${args.cid}/`);
        break;

      // OSM FEATURES
      case "get_osm_feature":
        result = await callApi("/osm_id/", { params: { osm_id: args.osm_id } });
        break;

      // SNAPSHOT
      case "request_snapshot": {
        const body = { geometry: args.geometry };
        if (args.outputType) body.outputType = args.outputType;
        if (args.geometryType) body.geometryType = args.geometryType;
        if (args.filters) body.filters = args.filters;
        if (args.fileName) body.fileName = args.fileName;
        if (args.centroid !== undefined) body.centroid = args.centroid;
        if (args.useStWithin !== undefined) body.useStWithin = args.useStWithin;
        if (args.includeStatsHtml !== undefined) body.includeStatsHtml = args.includeStatsHtml;
        if (args.includeTranslit !== undefined) body.includeTranslit = args.includeTranslit;
        if (args.minZoom !== undefined) body.minZoom = args.minZoom;
        if (args.maxZoom !== undefined) body.maxZoom = args.maxZoom;
        result = await callApi("/snapshot/", { method: "POST", body });
        break;
      }
      case "request_snapshot_plain": {
        const body = { geometry: args.geometry };
        if (args.outputType) body.outputType = args.outputType;
        if (args.geometryType) body.geometryType = args.geometryType;
        if (args.filters) body.filters = args.filters;
        if (args.centroid !== undefined) body.centroid = args.centroid;
        result = await callApi("/snapshot/plain/", { method: "POST", body });
        break;
      }

      // CUSTOM EXPORT
      case "request_custom_snapshot": {
        const body = { categories: args.categories };
        if (args.geometry) body.geometry = args.geometry;
        if (args.iso3) body.iso3 = args.iso3;
        if (args.hdxUpload !== undefined) body.hdxUpload = args.hdxUpload;
        if (args.dataset) body.dataset = args.dataset;
        if (args.includeStats !== undefined) body.includeStats = args.includeStats;
        if (args.includeStatsHtml !== undefined) body.includeStatsHtml = args.includeStatsHtml;
        if (args.includeTranslit !== undefined) body.includeTranslit = args.includeTranslit;
        result = await callApi("/custom/snapshot/", { method: "POST", body, requiresAuth: true });
        break;
      }
      case "request_custom_snapshot_yaml": {
        result = await callApi("/custom/snapshot/yaml/", {
          method: "POST",
          body: args.yaml_config,
          requiresAuth: true,
        });
        break;
      }

      // TASK MANAGEMENT
      case "get_task_status":
        result = await callApi(`/tasks/status/${args.task_id}/`, {
          params: { only_args: args.only_args },
        });
        break;
      case "revoke_task":
        result = await callApi(`/tasks/revoke/${args.task_id}/`, { requiresAuth: true });
        break;
      case "get_task_queue_info":
        result = await callApi("/tasks/queue/");
        break;
      case "get_task_queue_details":
        result = await callApi(`/tasks/queue/details/${args.queue_name}/`, {
          params: { args: args.args },
        });
        break;
      case "ping_workers":
        result = await callApi("/tasks/ping/");
        break;
      case "inspect_workers":
        result = await callApi("/tasks/inspect/", {
          params: { summary: args.summary !== undefined ? args.summary : true },
        });
        break;

      // METRICS
      case "get_metrics_summary":
        result = await callApi("/metrics/summary", {
          params: {
            start_date: args.start_date,
            end_date: args.end_date,
            group_by: args.group_by,
            folders: args.folders,
            include_locations: args.include_locations,
            include_referrers: args.include_referrers,
          },
          requiresAuth: true,
        });
        break;
      case "get_meta_downloads":
        result = await callApi("/metrics/meta-downloads", {
          params: {
            start_date: args.start_date,
            end_date: args.end_date,
            group_by: args.group_by,
            key_prefixes: args.key_prefixes,
            limit: args.limit || 100,
            offset: args.offset || 0,
          },
          requiresAuth: true,
        });
        break;

      // S3 FILES
      case "list_s3_files":
        result = await callApi("/s3/files/", {
          params: {
            folder: args.folder || "/HDX",
            prettify: args.prettify,
          },
        });
        break;
      case "get_s3_file":
        result = await callApi(`/s3/get/${args.file_path}`, {
          params: {
            expiry: args.expiry,
            read_meta: args.read_meta,
          },
        });
        break;

      // CRON JOBS
      case "list_cron_jobs":
        result = await callApi("/cron/", {
          params: {
            skip: args.skip || 0,
            limit: args.limit || 10,
          },
        });
        break;
      case "search_cron_jobs":
        result = await callApi("/cron/search/", {
          params: {
            dataset_title: args.dataset_title,
            skip: args.skip || 0,
            limit: args.limit || 10,
          },
        });
        break;
      case "get_cron_job":
        result = await callApi(`/cron/${args.cron_id}`);
        break;

      // AUTH
      case "get_login_url":
        result = await callApi("/auth/login/");
        break;
      case "get_my_profile":
        result = await callApi("/auth/me/", { requiresAuth: true });
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// --- START ---
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("HOTOSM Raw Data MCP Server v1.0.0 running on stdio");
  if (!HOTOSM_ACCESS_TOKEN) {
    console.error("Note: No HOTOSM_ACCESS_TOKEN found. Public endpoints will work; auth-required endpoints will fail.");
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
