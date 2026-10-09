import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { EmailClient } from "@azure/communication-email";
import { WaitlistStore } from "./storage.js";
import { createHandlers } from "./waitlist.js";
import { loadConfig } from "./config.js";

let handlers;
function getHandlers() {
  if (!handlers) {
    const config = loadConfig();
    const table = TableClient.fromConnectionString(config.storageConnection, config.tableName);
    const limits = TableClient.fromConnectionString(config.storageConnection, config.limitsTableName);
    const email = config.emailEnabled ? new EmailClient(config.emailConnection) : null;
    handlers = createHandlers({
      config,
      store: new WaitlistStore(table, limits),
      sendEmail: async (message) => {
        if (!email) throw new Error("Email sending is disabled");
        const abortSignal = AbortSignal.timeout(20_000);
        const poller = await email.beginSend(message, { updateIntervalInMs: 1000, abortSignal });
        const result = await poller.pollUntilDone({ abortSignal });
        if (result.status !== "Succeeded") throw new Error("Email submission did not succeed");
      },
    });
  }
  return handlers;
}

for (const [name, route, methods] of [
  ["register", "waitlist", ["POST"]],
  ["confirm", "waitlist/confirm", ["GET", "POST"]],
  ["unsubscribe", "waitlist/unsubscribe", ["GET", "POST"]],
]) {
  app.http(`waitlist-${name}`, {
    route, methods, authLevel: "anonymous",
    handler: async (request, context) => {
      try {
        return await getHandlers()[name](request, context);
      } catch (error) {
        context.error("waitlist.configuration_failed", {
          invocationId: context.invocationId,
          errorType: error.name,
        });
        return {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
          body: "The waitlist is temporarily unavailable. Please try again later.",
        };
      }
    },
  });
}
