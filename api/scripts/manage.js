import { TableClient, odata } from "@azure/data-tables";
import { signToken } from "../src/tokens.js";
import { isMissingEntity } from "../src/storage.js";

const command = process.argv[2];
if (!["export", "prune"].includes(command)) {
  console.error("Usage: node scripts/manage.js export|prune");
  process.exitCode = 1;
} else {
  try {
    const connection = process.env.WAITLIST_STORAGE_CONNECTION_STRING;
    const tableName = process.env.WAITLIST_TABLE;
    if (!connection || !tableName) throw new Error("Storage settings are required");
    const table = TableClient.fromConnectionString(connection, tableName);
    const now = Date.now();
    if (command === "export") {
      const secret = process.env.WAITLIST_TOKEN_SECRET;
      const baseUrl = new URL(process.env.WAITLIST_BASE_URL);
      if (!secret || secret.length < 32 || baseUrl.protocol !== "https:" ||
          baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) {
        throw new Error("A token secret and HTTPS base URL are required for export");
      }
      for await (const record of table.listEntities({
        queryOptions: { filter: odata`PartitionKey eq 'waitlist' and status eq 'confirmed'` },
      })) {
        const token = signToken(secret, record, "unsubscribe", Number.MAX_SAFE_INTEGER);
        process.stdout.write(`${JSON.stringify({
          email: record.email, company: record.company, productType: record.productType,
          designPartner: record.designPartner, consentVersion: record.consentVersion,
          requestedAt: record.requestedAt, confirmedAt: record.confirmedAt,
          unsubscribeUrl: `${baseUrl.origin}/api/waitlist/unsubscribe?token=${token}`,
        })}\n`);
      }
    } else {
      let deleted = 0;
      const cutoff = new Date(now).toISOString();
      for await (const record of table.listEntities({
        queryOptions: { filter: odata`PartitionKey eq 'waitlist' and status eq 'pending' and expiresAt le ${cutoff}` },
      })) {
        try {
          await table.deleteEntity(record.partitionKey, record.rowKey, { etag: record.etag });
          deleted++;
        } catch (error) {
          // A concurrent confirmation or resend takes precedence over maintenance.
          if (!isMissingEntity(error) && error.statusCode !== 412) throw error;
        }
      }
      console.log(`Deleted ${deleted} expired pending signups.`);
    }
  } catch (error) {
    console.error("Waitlist management failed:", {
      errorType: error.name,
      code: typeof error.code === "string" ? error.code : "unavailable",
      status: error.statusCode,
    });
    process.exitCode = 1;
  }
}
