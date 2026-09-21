# Backend deploy guide: DynamoDB + Lambda + API Gateway

Adds real storage behind the page: a DynamoDB table, two Lambda functions
(get-events.mjs, post-events.mjs), and an HTTP API in front of them.
Console labels change over time, so verify each step against current AWS docs.
Keep adding to your evidence log as you go.

## 0. Table design
- Table name: `CampusTechEvents`
- Partition key: `school` (String)
- Sort key: `eventId` (String)
- Other attributes (not indexed): `title`, `company`, `type`, `start`, `end`,
  `location`, `url`, `status` (`pending` | `approved`), `createdAt`
- Read pattern: Query by `school`, filtered to `status = approved`. This is
  a Query, not a Scan, because the partition key is known ahead of time.

## 1. Create the DynamoDB table
Console: DynamoDB > Tables > Create table.
- Table name: `CampusTechEvents`
- Partition key: `school` (String)
- Sort key: `eventId` (String)
- Table settings: Default (on-demand capacity) is fine at this scale and
  avoids paying for idle provisioned capacity.

CLI equivalent:
```
aws dynamodb create-table \
  --table-name CampusTechEvents \
  --attribute-definitions AttributeName=school,AttributeType=S AttributeName=eventId,AttributeType=S \
  --key-schema AttributeName=school,KeyType=HASH AttributeName=eventId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region <your-region>
```

## 2. Create an IAM role for the Lambda functions
Console: IAM > Roles > Create role > AWS service > Lambda.
- Attach the AWS managed policy `AWSLambdaBasicExecutionRole` (CloudWatch Logs only).
- Add an inline policy scoped to just this table, not to all of DynamoDB:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Query", "dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/CampusTechEvents"
    }
  ]
}
```
Both Query (used by get-events) and PutItem (used by post-events) are listed
so one role can serve both functions. Using two separate roles, one per
function with only the action it needs, is stricter and closer to least
privilege if you want the extra practice.

## 3. Create the Lambda functions
Console: Lambda > Create function, twice.
- Runtime: Node.js 20.x (or the current LTS Node runtime).
- Execution role: the role from step 2.
- Function 1: `get-events`. Paste in `get-events.mjs`. Handler: `get-events.handler`
  (or rename the file to `index.mjs` and leave the handler as `index.handler`).
- Function 2: `post-events`. Paste in `post-events.mjs`. Handler set the same way.
- For each function, add environment variables:
  - `TABLE_NAME` = `CampusTechEvents`
  - `ALLOWED_ORIGIN` = your CloudFront URL once you have it (for example
    `https://dxxxxxxxxxxxxx.cloudfront.net`). Using `*` works too but is
    looser than it needs to be for a POST endpoint.

The AWS SDK v3 packages used in both files (`@aws-sdk/client-dynamodb`,
`@aws-sdk/lib-dynamodb`) are bundled into the Node.js Lambda runtime, so no
node_modules folder or zip build step is needed. Pasting the file directly
into the console editor is enough.

## 4. Create the HTTP API
Console: API Gateway > Create API > HTTP API (not REST API; HTTP API is
simpler and cheaper for this use case).
- Add route `GET /events` → integration: Lambda `get-events`.
- Add route `POST /events` → integration: Lambda `post-events`.
- CORS: under the API's CORS settings, allow your CloudFront origin (or `*`
  while testing), methods `GET, POST, OPTIONS`, headers `Content-Type`.
- Deploy to the `$default` stage (HTTP APIs do this automatically).
- Throttling: API Gateway > your API > the stage > Edit throttling. Set a
  low rate and burst (for example rate 10, burst 20 requests/second) so a
  traffic spike or a bug in your own code cannot run up a bill.
- Note the Invoke URL, something like `https://abc123.execute-api.<region>.amazonaws.com`.

## 5. Test before wiring up the page
```
curl "https://<api-id>.execute-api.<region>.amazonaws.com/events?school=ut-austin"
# expect: []  (nothing approved yet)

curl -X POST "https://<api-id>.execute-api.<region>.amazonaws.com/events" \
  -H "Content-Type: application/json" \
  -d '{"school":"ut-austin","title":"Test event","company":"Test Co","type":"Other","start":"2026-10-01T18:00"}'
# expect: {"id":"...","status":"pending"}
```
Then in the DynamoDB console, open the table's Items, find that row, and
change `status` from `pending` to `approved`. Re-run the GET curl command
and confirm the event now shows up.

## 6. Point the page at the API
In `index.html`, set:
```js
const API_BASE = "https://<api-id>.execute-api.<region>.amazonaws.com";
```
Re-upload `index.html` to your S3 bucket (see deploy.md step 4), then create
a CloudFront invalidation for `/index.html` so the change shows immediately.

## 7. Ongoing approval workflow
Every submission lands as `pending`. To publish one, open DynamoDB > Tables >
CampusTechEvents > Explore table items, find the row, edit `status` to
`approved`. There is no UI for this yet; the console is the moderation queue.

## 8. Add the flower (interest) counter
This is an optional add-on: a per-event "flower" button that visitors can
tap to show interest, with a running count on the card, plus a server-side
dedup layer so the same network can't run the count up by repeat-clicking.

### 8a. Dedup log table
- Create a second DynamoDB table: `CampusEventFlowerLog`.
  - Partition key: `flowerKey` (String): a hash of school + event + IP,
    not the IP itself.
  - No sort key needed.
- Enable TTL on this table: Table > Additional settings > Time to live (TTL)
  attribute, set to `ttl`. Items expire and are deleted automatically once
  their `ttl` (epoch seconds) passes, so this table cleans itself up with no
  extra Lambda or cron job.

CLI equivalent for table creation:
```
aws dynamodb create-table \
  --table-name CampusEventFlowerLog \
  --attribute-definitions AttributeName=flowerKey,AttributeType=S \
  --key-schema AttributeName=flowerKey,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region <your-region>

aws dynamodb update-time-to-live \
  --table-name CampusEventFlowerLog \
  --time-to-live-specification "Enabled=true, AttributeName=ttl" \
  --region <your-region>
```

### 8b. IAM
Update the inline policy from step 2 to cover both tables and the extra
actions this Lambda needs:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/CampusTechEvents"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/CampusEventFlowerLog"
    }
  ]
}
```

### 8c. Lambda and API Gateway
- Create a third function, `flower-event`, same runtime and role as the
  other two. Paste in `post-flower.mjs`. Environment variables:
  - `TABLE_NAME` = `CampusTechEvents`
  - `FLOWER_LOG_TABLE` = `CampusEventFlowerLog`
  - `ALLOWED_ORIGIN` = same value as the other functions
  - `FLOWER_DEDUP_SECONDS` = `86400` (24 hours; lower this if false
    positives on shared campus wifi turn out to matter more than blocking
    repeat clicks)
- API Gateway: add route `POST /events/{id}/flower` on the same HTTP API,
  integration: Lambda `flower-event`. The `{id}` segment is a path
  parameter; the function reads it from `event.pathParameters.id`.
- No migration needed on the events table. `flowerCount` starts out missing
  on existing items and the code treats a missing value as 0 everywhere.

### 8d. Test
```
curl -X POST "https://<api-id>.execute-api.<region>.amazonaws.com/events/<event-id>/flower?school=ut-austin"
# expect: {"flowerCount":1}

curl -X POST "https://<api-id>.execute-api.<region>.amazonaws.com/events/<event-id>/flower?school=ut-austin"
# same IP again, within the window, expect: HTTP 409 and {"error":"Already flowered recently","flowerCount":1}
```

### 8e. What this does and doesn't protect against
- Blocks: one browser or script hammering the same event from the same
  network.
- Does not block: the same person flowering from their phone, then their
  laptop, then a friend's computer. It's a per-network limit, not a
  per-person one, since there's no login.
- Side effect: a shared network (dorm wifi, a campus NAT) can make one
  student's flower block a roommate's for the rest of the window. This is
  the trade-off of doing this without accounts; shortening
  `FLOWER_DEDUP_SECONDS` reduces it at the cost of weaker abuse protection.
- The flower icon looks for `flower.png` next to `index.html` in the S3
  bucket. Upload it there (same `aws s3 cp` pattern as step 1's `index.html`
  upload). Until it exists, the button shows an inline SVG flower instead of
  breaking.

## 9. Do not do these
- Do not set `ALLOWED_ORIGIN` or CORS to `*` for POST once you have a real
  domain to allow, since a public POST endpoint that anyone's page can call
  is easier to abuse.
- Do not remove the throttle in step 4 even if testing feels slow.
- Do not delete the table, functions, or API before judging finishes.
- Do not treat the flower count as a verified, one-per-person vote in your
  project write-up; describe it accurately as a per-network interest
  signal, not a per-person one.
- Do not set `FLOWER_DEDUP_SECONDS` to something very long (weeks) without
  weighing the shared-network trade-off in 8e.
