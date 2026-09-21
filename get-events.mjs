// GET /events?school=ut-austin
// Returns only approved events for the requested school.
// Uses the AWS SDK v3, which is bundled in the Lambda Node.js runtime,
// so this file can be uploaded as-is with no node_modules.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Content-Type": "application/json"
};

export const handler = async (event) => {
  try {
    const school = event.queryStringParameters?.school || "ut-austin";

    const result = await client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "school = :s",
      FilterExpression: "#status = :approved",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":s": school, ":approved": "approved" }
    }));

    const items = (result.Items || []).map((i) => ({
      id: i.eventId,
      school: i.school,
      title: i.title,
      company: i.company,
      type: i.type,
      start: i.start,
      end: i.end || "",
      location: i.location || "",
      url: i.url || "",
      flowerCount: i.flowerCount || 0
    }));

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(items) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not load events" }) };
  }
};
