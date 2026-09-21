// POST /events/{id}/flower?school=ut-austin
//
// Increments flowerCount by 1 on one event, but first checks a separate
// dedup log table to block the same network (by hashed IP) from flowering
// the same event again within FLOWER_DEDUP_SECONDS (default 24h).
//
// This is not per-person: it is per public IP. Shared networks (dorm wifi,
// a campus NAT) can make one student's flower block a roommate's for the
// rest of that window. There is no login here, so this is a rate limit on
// abuse, not proof that each flower came from a different person. Shorten
// FLOWER_DEDUP_SECONDS if the shared-network false positive matters more
// to you than blocking repeat clicks.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;
const LOG_TABLE = process.env.FLOWER_LOG_TABLE;
const DEDUP_SECONDS = Number(process.env.FLOWER_DEDUP_SECONDS || 86400); // 24 hours

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json"
};

function hashKey(parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export const handler = async (event) => {
  try {
    const eventId = event.pathParameters?.id;
    const school = event.queryStringParameters?.school || "ut-austin";
    if (!eventId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing event id" }) };
    }

    const sourceIp = event.requestContext?.http?.sourceIp || "unknown";
    const flowerKey = hashKey([school, eventId, sourceIp]);
    const nowSec = Math.floor(Date.now() / 1000);

    try {
      await client.send(new PutCommand({
        TableName: LOG_TABLE,
        Item: { flowerKey, ttl: nowSec + DEDUP_SECONDS },
        ConditionExpression: "attribute_not_exists(flowerKey)"
      }));
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        const current = await client.send(new GetCommand({ TableName: TABLE, Key: { school, eventId } }));
        return {
          statusCode: 409,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Already flowered recently", flowerCount: current.Item?.flowerCount || 0 })
        };
      }
      throw err;
    }

    const result = await client.send(new UpdateCommand({
      TableName: TABLE,
      Key: { school, eventId },
      UpdateExpression: "ADD flowerCount :one",
      ConditionExpression: "attribute_exists(eventId)",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "UPDATED_NEW"
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ flowerCount: result.Attributes.flowerCount })
    };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: "Event not found" }) };
    }
    console.error(err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: "Could not add flower" }) };
  }
};
