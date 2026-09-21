// POST /events
// Saves a submitted event with status "pending". Nothing here is shown on
// the site until you manually change its status to "approved" in the
// DynamoDB console. All fields are re-validated here even though the page
// also validates them, because a client-side check can always be bypassed.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json"
};

const SCHOOLS = new Set(["ut-austin"]);
const TYPES = new Set(["Career fair", "Networking", "Recruiting mixer", "Tech talk", "Workshop", "Other"]);
const MAX_LEN = { title: 120, company: 80, location: 120, url: 300 };

function isHttpUrl(u) {
  if (!u) return true;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    const school = SCHOOLS.has(body.school) ? body.school : "ut-austin";
    const title = String(body.title || "").trim().slice(0, MAX_LEN.title);
    const company = String(body.company || "").trim().slice(0, MAX_LEN.company);
    const type = TYPES.has(body.type) ? body.type : "Other";
    const start = String(body.start || "");
    const end = String(body.end || "");
    const location = String(body.location || "").trim().slice(0, MAX_LEN.location);
    const url = String(body.url || "").trim().slice(0, MAX_LEN.url);

    if (!title || !company || !start || Number.isNaN(Date.parse(start)) || !isHttpUrl(url)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing or invalid fields" }) };
    }

    const eventId = randomUUID();
    await client.send(new PutCommand({
      TableName: TABLE,
      Item: {
        school,
        eventId,
        title,
        company,
        type,
        start,
        end,
        location,
        url,
        status: "pending",
        createdAt: new Date().toISOString()
      }
    }));

    return { statusCode: 201, headers: CORS_HEADERS, body: JSON.stringify({ id: eventId, status: "pending" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not save event" }) };
  }
};
