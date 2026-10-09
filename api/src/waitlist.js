import { createHash, randomBytes } from "node:crypto";
import { RequestError } from "./storage.js";
import { signToken, verifyToken } from "./tokens.js";

const MAX_BODY_BYTES = 8192;
const TOKEN_LIFETIME = 48 * 60 * 60 * 1000;
const CONSENT_VERSION = "waitlist-2026-10";
const PRODUCT_TYPES = new Set([
  "Devices or embedded software", "Industrial or machine software",
  "On-premises software", "SaaS", "Something else",
]);

function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function page(status, title, text, content = "") {
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Robots-Tag": "noindex, nofollow",
    },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} - Bomkeeper</title><style>body{margin:0;padding:64px 24px;background:#0A0C1D;color:#E9EAF2;font:18px/1.6 system-ui,sans-serif}main{max-width:640px;margin:auto}a{color:#6EE7B7}button{background:#6EE7B7;border:0;border-radius:8px;padding:14px 24px;font:inherit;cursor:pointer}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(text)}</p>${content}<p><a href="/">Back to Bomkeeper</a></p></main></body></html>`,
  };
}

function audit(context, event, error) {
  context.error(event, {
    invocationId: context.invocationId,
    code: typeof error?.code === "string" ? error.code : "unavailable",
    status: error?.statusCode,
  });
}

async function formData(request, config) {
  const origin = request.headers.get("origin");
  if (!origin || !config.allowedOrigins.includes(origin)) {
    throw new RequestError(403, "Please submit this form from the Bomkeeper website.");
  }
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new RequestError(415, "Please use the waitlist form on the website.");
  }
  const declaredSize = request.headers.get("content-length");
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_BODY_BYTES)) {
    throw new RequestError(413, "The submitted form is too large.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new RequestError(413, "The submitted form is too large.");
  const form = new URLSearchParams(text);
  for (const key of new Set(form.keys())) {
    if (form.getAll(key).length !== 1) throw new RequestError(400, "The submitted form contains duplicate fields.");
  }
  return form;
}

export function createHandlers({ config, store, sendEmail, now = Date.now }) {
  const guarded = (handler) => async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof RequestError) {
        context.warn("waitlist.request_rejected", { status: error.status, invocationId: context.invocationId });
        const response = page(error.status, "Unable to complete your request", error.message);
        if (error.status === 429) response.headers["Retry-After"] = "3600";
        return response;
      }
      audit(context, "waitlist.operation_failed", error);
      return page(503, "Waitlist temporarily unavailable", "Your request could not be completed. Please try again in a few minutes.");
    }
  };

  const register = guarded(async (request, context) => {
    const form = await formData(request, config);
    if (form.get("website")) {
      context.warn("waitlist.honeypot_rejected", { invocationId: context.invocationId });
      throw new RequestError(400, "The submitted form could not be accepted.");
    }
    const email = (form.get("email") ?? "").trim().toLowerCase();
    const company = (form.get("company") ?? "").trim();
    const type = form.get("type") ?? "";
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email) ||
        email.length > 254 || email.split("@")[0].length > 64 ||
        company.length > 200 || /[\x00-\x1f\x7f]/.test(company) ||
        !PRODUCT_TYPES.has(type) || form.get("consent") !== "yes" ||
        (form.has("design_partner") && form.get("design_partner") !== "on")) {
      throw new RequestError(400, "Enter a valid email address, choose your product type and agree to the waitlist updates.");
    }
    if (!config.emailEnabled) throw new RequestError(503, "Email verification is not yet available. Please try again later.");
    const timestamp = now();
    const record = {
      rowKey: createHash("sha256").update(email).digest("hex"),
      generation: randomBytes(32).toString("hex"),
      email, company, productType: type,
      designPartner: form.get("design_partner") === "on",
      status: "pending",
      consentVersion: CONSENT_VERSION,
      requestedAt: new Date(timestamp).toISOString(),
      lastRequestedAt: new Date(timestamp).toISOString(),
      expiresAt: new Date(timestamp + TOKEN_LIFETIME).toISOString(),
    };
    if (await store.claim(record, timestamp)) {
      try {
        await store.reserveEmail(timestamp, config.hourlyEmailLimit);
        const confirm = `${config.baseUrl}/api/waitlist/confirm?token=${signToken(config.secret, record, "confirm", timestamp + TOKEN_LIFETIME)}`;
        const unsubscribe = `${config.baseUrl}/api/waitlist/unsubscribe?token=${signToken(config.secret, record, "unsubscribe", Number.MAX_SAFE_INTEGER)}`;
        await sendEmail({
          senderAddress: config.sender,
          recipients: { to: [{ address: email }] },
          content: {
            subject: "Confirm your Bomkeeper waitlist signup",
            plainText: `Confirm that you want Bomkeeper early-access and product updates:\n\n${confirm}\n\nThis link expires in 48 hours. Open it and press Confirm signup. If you did not request this, ignore this email or delete the signup:\n${unsubscribe}\n\nBomkeeper - ${config.baseUrl}`,
          },
        });
      } catch (error) {
        try {
          await store.releaseFailedClaim(record.rowKey, record.generation, now());
        } catch (releaseError) {
          audit(context, "waitlist.claim_release_failed", releaseError);
        }
        throw error;
      }
    }
    return page(200, "Check your inbox", "If this address is eligible for a new signup, we have sent a confirmation email. Check your spam folder too. Existing subscribers do not need to sign up again; confirmation emails can be requested once per hour.");
  });

  function tokenHandler(purpose) {
    return guarded(async (request) => {
      const form = request.method === "POST" ? await formData(request, config) : null;
      const token = form ? form.get("token") : new URL(request.url).searchParams.get("token");
      const timestamp = now();
      const payload = verifyToken(config.secret, token, purpose, timestamp);
      if (!payload) throw new RequestError(400, "This link is invalid or expired. Please return to the website to sign up again.");
      if (request.method === "GET") {
        const label = purpose === "confirm" ? "Confirm signup" : "Unsubscribe";
        return page(200, label,
          purpose === "confirm" ? "Confirm that you want to receive Bomkeeper early-access and product updates." : "Remove your signup and stop receiving Bomkeeper waitlist updates.",
          `<form method="post" action="/api/waitlist/${purpose}"><input type="hidden" name="token" value="${escape(token)}"><button type="submit">${label}</button></form>`);
      }
      if (purpose === "confirm") {
        if (!await store.confirm(payload.id, payload.generation, timestamp)) {
          throw new RequestError(400, "This signup has expired or was replaced. Please sign up again.");
        }
        const record = { rowKey: payload.id, generation: payload.generation };
        const unsubscribe = `/api/waitlist/unsubscribe?token=${signToken(config.secret, record, "unsubscribe", Number.MAX_SAFE_INTEGER)}`;
        return page(200, "You're on the list", "Your email address is confirmed. We will contact you with Bomkeeper updates.",
          `<p><a href="${escape(unsubscribe)}">Unsubscribe and delete my signup</a></p>`);
      }
      if (!await store.remove(payload.id, payload.generation)) {
        throw new RequestError(400, "This link belongs to an older signup. Please use the link from your latest email.");
      }
      return page(200, "You have been unsubscribed", "Your waitlist signup has been deleted.");
    });
  }

  return { register, confirm: tokenHandler("confirm"), unsubscribe: tokenHandler("unsubscribe") };
}
