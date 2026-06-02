/**
 * UNHCR Refugee Statistics API MCP Server
 *
 * Public API — no authentication required.
 * Run: node server.js
 */

const { execFileSync, execSync } = require('child_process');

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

const BASE_URL = "https://api.unhcr.org/population/v1";

const server = new Server(
  { name: "unhcr-refugee-statistics-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

async function callUnhcrApi(endpoint, params = {}) {
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)
  );
  try {
    const response = await axios.get(`${BASE_URL}${endpoint}`, {
      params: cleanParams,
      headers: { Accept: "application/json" },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`API Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Request failed: ${error.message}`);
  }
}

// Shared parameter definitions for data endpoints
const DATA_PARAMS = {
  limit: { type: "integer", description: "Number of items to return (default: 100)" },
  page: { type: "integer", description: "Pagination page number" },
  yearFrom: { type: "integer", description: "Start year (inclusive)" },
  yearTo: { type: "integer", description: "End year (inclusive)" },
  year: { type: "string", description: "Specific year(s), comma-separated (e.g. '2020,2021')" },
  coo: { type: "string", description: "Country of origin — 3-char UNHCR code(s), comma-separated (e.g. 'AFG,SYR')" },
  coa: { type: "string", description: "Country of asylum — 3-char UNHCR code(s), comma-separated" },
  cooAll: { type: "boolean", description: "Include all countries of origin" },
  coaAll: { type: "boolean", description: "Include all countries of asylum" },
  cfType: { type: "string", description: "Country code type: omit for UNHCR codes, set 'ISO' for ISO3 codes" },
  download: { type: "boolean", description: "Set true to receive results as CSV instead of JSON" },
};

// --- TOOL DEFINITIONS ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [

      // ── POPULATION ───────────────────────────────────────────────────────────
      {
        name: "get_population",
        description: "Get refugee and displaced population figures (refugees, asylum seekers, IDPs, stateless persons, etc.) by year and country. (Docs: /population/v1/population/)",
        inputSchema: {
          type: "object",
          properties: {
            ...DATA_PARAMS,
            columns: {
              type: "string",
              description: "Population types to include, comma-separated. Options: refugees, asylum_seekers, idps, oip, stateless, ooc, hst",
            },
          },
        },
      },

      // ── ASYLUM APPLICATIONS ──────────────────────────────────────────────────
      {
        name: "get_asylum_applications",
        description: "Get asylum claims submitted by year and countries of asylum/origin. (Docs: /population/v1/asylum-applications/)",
        inputSchema: {
          type: "object",
          properties: { ...DATA_PARAMS },
        },
      },

      // ── ASYLUM DECISIONS ─────────────────────────────────────────────────────
      {
        name: "get_asylum_decisions",
        description: "Get decisions taken on asylum claims (recognized, rejected, complementary protection, etc.) by year and country. (Docs: /population/v1/asylum-decisions/)",
        inputSchema: {
          type: "object",
          properties: { ...DATA_PARAMS },
        },
      },

      // ── SOLUTIONS ────────────────────────────────────────────────────────────
      {
        name: "get_solutions",
        description: "Get durable solutions data: voluntary repatriation, resettlement, and naturalization figures by year and country. (Docs: /population/v1/solutions/)",
        inputSchema: {
          type: "object",
          properties: { ...DATA_PARAMS },
        },
      },

      // ── DEMOGRAPHICS ─────────────────────────────────────────────────────────
      {
        name: "get_demographics",
        description: "Get demographic and sub-national population data disaggregated by age, sex, and population type. (Docs: /population/v1/demographics/)",
        inputSchema: {
          type: "object",
          properties: {
            ...DATA_PARAMS,
            columns: {
              type: "string",
              description: "Population types to include, comma-separated. Options: refugees, asylum_seekers, idps, oip, stateless, ooc",
            },
            ptype_show: {
              type: "boolean",
              description: "When true, disaggregates results by population type",
            },
          },
        },
      },

      // ── IDMC (INTERNAL DISPLACEMENT) ─────────────────────────────────────────
      {
        name: "get_idmc",
        description: "Get Internal Displacement Monitoring Centre (IDMC) data on internally displaced persons (IDPs) by country and year. (Docs: /population/v1/idmc/)",
        inputSchema: {
          type: "object",
          properties: { ...DATA_PARAMS },
        },
      },

      // ── UNRWA ────────────────────────────────────────────────────────────────
      {
        name: "get_unrwa",
        description: "Get UNRWA (UN Relief and Works Agency) registered Palestine refugee population data by year and territory. (Docs: /population/v1/unrwa/)",
        inputSchema: {
          type: "object",
          properties: { ...DATA_PARAMS },
        },
      },

      // ── NOWCASTING ───────────────────────────────────────────────────────────
      {
        name: "get_nowcasting",
        description: "Get nowcasting / predictive refugee population estimates for the current period. (Docs: /population/v1/nowcasting/)",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Number of items to return (default: 100)" },
            page: { type: "integer", description: "Pagination page number" },
            coo: { type: "string", description: "Country of origin — 3-char UNHCR code(s), comma-separated" },
            coa: { type: "string", description: "Country of asylum — 3-char UNHCR code(s), comma-separated" },
            cfType: { type: "string", description: "Country code type: 'ISO' for ISO3 codes" },
          },
        },
      },

      // ── COUNTRIES ────────────────────────────────────────────────────────────
      {
        name: "list_countries",
        description: "List all countries with their UNHCR codes, ISO codes, names, and regional groupings. Use this to look up country codes for other queries. (Docs: /population/v1/countries/)",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Number of items to return (default: 100)" },
            page: { type: "integer", description: "Pagination page number" },
            region: { type: "string", description: "Filter by UNSD sub-region name" },
            unhcr_region: { type: "integer", description: "Filter by UNHCR region ID" },
          },
        },
      },

      // ── REGIONS ──────────────────────────────────────────────────────────────
      {
        name: "list_regions",
        description: "List all UNHCR regional bureaux / geographic regions with their IDs and names. (Docs: /population/v1/regions/)",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Number of items to return (default: 100)" },
            page: { type: "integer", description: "Pagination page number" },
          },
        },
      },

      // ── YEARS ────────────────────────────────────────────────────────────────
      {
        name: "list_years",
        description: "List all years for which refugee statistics data is available in the UNHCR database. (Docs: /population/v1/years/)",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Number of items to return (default: 100)" },
            page: { type: "integer", description: "Pagination page number" },
          },
        },
      },

      // ── FOOTNOTES ────────────────────────────────────────────────────────────
      {
        name: "get_footnotes",
        description: "Get methodology notes and data footnotes explaining caveats, data sources, and definitions for specific country-year combinations. (Docs: /population/v1/footnotes/)",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Number of items to return (default: 100)" },
            page: { type: "integer", description: "Pagination page number" },
            yearFrom: { type: "integer", description: "Start year (inclusive)" },
            yearTo: { type: "integer", description: "End year (inclusive)" },
            coo: { type: "string", description: "Country of origin — 3-char UNHCR code(s), comma-separated" },
            coa: { type: "string", description: "Country of asylum — 3-char UNHCR code(s), comma-separated" },
          },
        },
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

      // POPULATION
      case "get_population":
        result = await callUnhcrApi("/population/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          "year[]": args.year ? args.year.split(",") : undefined,
          coo: args.coo,
          coa: args.coa,
          cooAll: args.cooAll,
          coaAll: args.coaAll,
          cfType: args.cfType,
          columns: args.columns,
          download: args.download,
        });
        break;

      // ASYLUM APPLICATIONS
      case "get_asylum_applications":
        result = await callUnhcrApi("/asylum-applications/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          "year[]": args.year ? args.year.split(",") : undefined,
          coo: args.coo,
          coa: args.coa,
          cooAll: args.cooAll,
          coaAll: args.coaAll,
          cfType: args.cfType,
          download: args.download,
        });
        break;

      // ASYLUM DECISIONS
      case "get_asylum_decisions":
        result = await callUnhcrApi("/asylum-decisions/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          "year[]": args.year ? args.year.split(",") : undefined,
          coo: args.coo,
          coa: args.coa,
          cooAll: args.cooAll,
          coaAll: args.coaAll,
          cfType: args.cfType,
          download: args.download,
        });
        break;

      // SOLUTIONS
      case "get_solutions":
        result = await callUnhcrApi("/solutions/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          "year[]": args.year ? args.year.split(",") : undefined,
          coo: args.coo,
          coa: args.coa,
          cooAll: args.cooAll,
          coaAll: args.coaAll,
          cfType: args.cfType,
          download: args.download,
        });
        break;

      // DEMOGRAPHICS
      case "get_demographics":
        result = await callUnhcrApi("/demographics/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          "year[]": args.year ? args.year.split(",") : undefined,
          coo: args.coo,
          coa: args.coa,
          cooAll: args.cooAll,
          coaAll: args.coaAll,
          cfType: args.cfType,
          columns: args.columns,
          ptype_show: args.ptype_show,
          download: args.download,
        });
        break;

      // IDMC
      case "get_idmc":
        result = await callUnhcrApi("/idmc/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          "year[]": args.year ? args.year.split(",") : undefined,
          coo: args.coo,
          coa: args.coa,
          cooAll: args.cooAll,
          coaAll: args.coaAll,
          cfType: args.cfType,
          download: args.download,
        });
        break;

      // UNRWA
      case "get_unrwa":
        result = await callUnhcrApi("/unrwa/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          "year[]": args.year ? args.year.split(",") : undefined,
          coo: args.coo,
          coa: args.coa,
          cooAll: args.cooAll,
          coaAll: args.coaAll,
          cfType: args.cfType,
          download: args.download,
        });
        break;

      // NOWCASTING
      case "get_nowcasting":
        result = await callUnhcrApi("/nowcasting/", {
          limit: args.limit,
          page: args.page,
          coo: args.coo,
          coa: args.coa,
          cfType: args.cfType,
        });
        break;

      // COUNTRIES
      case "list_countries":
        result = await callUnhcrApi("/countries/", {
          limit: args.limit,
          page: args.page,
          region: args.region,
          unhcr_region: args.unhcr_region,
        });
        break;

      // REGIONS
      case "list_regions":
        result = await callUnhcrApi("/regions/", {
          limit: args.limit,
          page: args.page,
        });
        break;

      // YEARS
      case "list_years":
        result = await callUnhcrApi("/years/", {
          limit: args.limit,
          page: args.page,
        });
        break;

      // FOOTNOTES
      case "get_footnotes":
        result = await callUnhcrApi("/footnotes/", {
          limit: args.limit,
          page: args.page,
          yearFrom: args.yearFrom,
          yearTo: args.yearTo,
          coo: args.coo,
          coa: args.coa,
        });
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
  console.error("UNHCR Refugee Statistics MCP Server v1.0.0 running on stdio");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
