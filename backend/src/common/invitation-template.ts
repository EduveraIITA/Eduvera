function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
}

/** Codes stay in the message body, never in links or remote image requests. */
export function invitationTemplate(input: {email: string; token: string; expires_at: Date | string; publicUrl: string}) {
  const joinUrl = new URL('/join', input.publicUrl).href;
  const expiry = new Date(input.expires_at).toISOString();
  const text = `You have been invited to join your institution on Eduera.\n\nOpen: ${joinUrl}\nEmail: ${input.email}\nInvitation code: ${input.token}\nExpires: ${expiry}\n\nUse the same email and enter this single-use code. For an existing account, use your current password. Do not forward this code. If you were not expecting this invitation, you can ignore this email.`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your invitation to Eduera</title></head>
<body style="margin:0;padding:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#172b4d">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fa"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e1e8f0;border-radius:16px">
<tr><td style="padding:28px 28px 20px;border-bottom:1px solid #e1e8f0"><span style="font-size:26px;font-weight:bold;color:#2563eb">Eduera</span><br><span style="font-size:13px;color:#52647a">Your institution. Connected.</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.3">You're invited to join</h1>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px">Your institution has invited you to Eduera. Use the code below to accept your invitation.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf9f5;border:1px solid #c9eade;border-radius:12px"><tr><td style="padding:20px;text-align:center">
<p style="margin:0 0 10px;font-size:12px;font-weight:bold;color:#365c50;text-transform:uppercase;letter-spacing:1px">Your invitation code</p>
<p style="margin:0;font-family:Consolas,monospace;font-size:22px;font-weight:bold;line-height:1.5;overflow-wrap:anywhere;word-break:break-all">${escapeHtml(input.token)}</p>
</td></tr></table>
<p style="font-size:14px;line-height:1.7;overflow-wrap:anywhere">Invited email: <strong>${escapeHtml(input.email)}</strong><br>Expires: ${escapeHtml(expiry)} (UTC)</p>
<p style="margin:24px 0"><a href="${escapeHtml(joinUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:16px;font-weight:bold">Accept invitation</a></p>
<p style="font-size:14px;line-height:1.7">Open the link, enter your invited email and code, and complete the join form. Already have an account? Use your current password.</p>
<p style="font-size:12px;line-height:1.7;color:#52647a;overflow-wrap:anywhere">Button not working? Open <a href="${escapeHtml(joinUrl)}" style="color:#2563eb">${escapeHtml(joinUrl)}</a></p>
</td></tr><tr><td style="padding:20px 28px;border-top:1px solid #e1e8f0;font-size:12px;line-height:1.7;color:#52647a">This code is single-use. Keep it private and do not forward this email. If you weren't expecting this invitation, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`;
  return {subject: 'Your invitation to Eduera', text, html};
}
