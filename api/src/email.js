function escape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function confirmationContent(confirm, unsubscribe, baseUrl) {
  return {
    subject: "Confirm your Bomkeeper waitlist signup",
    plainText: `Confirm that you want Bomkeeper early-access and product updates:\n\n${confirm}\n\nThis link expires in 48 hours. Click it to confirm your signup immediately. If you did not request this, ignore this email or delete the signup:\n${unsubscribe}\n\nBomkeeper - ${baseUrl}`,
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm your Bomkeeper waitlist signup</title></head>
<body style="margin:0;padding:0;background-color:#0A0C1D;color:#E9EAF2;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">You're one step away from Bomkeeper early access. Confirm your email within 48 hours.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0A0C1D">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
        <tr><td style="padding:0 0 24px"><a href="${escape(baseUrl)}" style="color:#E9EAF2;text-decoration:none;font-size:24px;font-weight:700">bomkeeper<span style="color:#6EE7B7">.</span></a><p style="margin:8px 0 0;color:#A3A8C3;font-size:14px">The evidence vault for SBOMs.</p></td></tr>
        <tr><td style="padding:32px 24px;background-color:#12152B;border:1px solid #262A45;border-radius:14px">
          <p style="margin:0 0 16px;font:12px monospace;letter-spacing:2px;text-transform:uppercase;color:#6EE7B7">Early access</p>
          <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;color:#E9EAF2">One more step. You're almost on the list.</h1>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#CDD0E0">Confirm your email to receive Bomkeeper early-access news and product updates.</p>
          <table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#6EE7B7" style="border-radius:10px"><a href="${escape(confirm)}" style="display:inline-block;padding:16px 24px;border:1px solid #6EE7B7;border-radius:10px;color:#0A0C1D;text-decoration:none;font-size:16px;font-weight:700">Confirm my signup</a></td></tr></table>
          <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#A3A8C3">This link expires in 48 hours. Clicking it confirms your signup immediately.</p>
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#A3A8C3">Button not working? Copy this link into your browser:<br><a href="${escape(confirm)}" style="color:#6EE7B7;word-break:break-all">${escape(confirm)}</a></p>
        </td></tr>
        <tr><td style="padding:24px 0;font-size:13px;line-height:1.6;color:#A3A8C3">Didn't request this? You can ignore this email or <a href="${escape(unsubscribe)}" style="color:#6EE7B7">delete your signup</a>. You can unsubscribe at any time.<br><br>Bomkeeper · Your SBOMs. Your evidence. Your control.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export async function submitEmail(client, message) {
  // ACS owns the queued operation after beginSend; do not wait for delivery in the HTTP request.
  const poller = await client.beginSend(message, { abortSignal: AbortSignal.timeout(20_000) });
  const state = poller.getOperationState();
  if (state.error || state.status === "failed" || state.status === "canceled") {
    throw state.error ?? new Error("Email submission did not succeed");
  }
}
