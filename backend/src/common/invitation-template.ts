import { invitationLogo } from './invitation-logo.js';
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
}

/** Fragment prefill stays out of HTTP requests and referrer headers. */
export function invitationTemplate(input: {email: string; token: string; expires_at: Date | string; publicUrl: string}) {
  const joinLink = new URL('/join', input.publicUrl);
  joinLink.hash = new URLSearchParams({email: input.email, token: input.token}).toString();
  const joinUrl = joinLink.href;
  const logoUrl = `cid:${invitationLogo.cid}`;
  const expiry = new Date(input.expires_at).toISOString();
  const displayExpiry = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'UTC',
  }).format(new Date(input.expires_at)) + ' UTC';
  const text = `You have been invited to join your institution on Eduera.\n\nOpen: ${joinUrl}\nEmail: ${input.email}\nInvitation code: ${input.token}\nExpires: ${expiry}\n\nOpen the invitation link to fill in your email and code automatically. The code above is only a backup. For an existing account, use your current password. Do not forward this code. If you were not expecting this invitation, you can ignore this email.`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your invitation to Eduera</title>
<style>@media only screen and (max-width:480px){.email-outer{padding:12px 8px!important}.email-section{padding:24px 20px!important}.email-heading{font-size:26px!important}.code-panel{padding:16px!important}.code-label{font-size:10px!important;letter-spacing:.5px!important}.invitation-code{font-size:30px!important;letter-spacing:4px!important}}</style></head>
<body style="margin:0;padding:0;background:#f3f6f8;font-family:Arial,Helvetica,sans-serif;color:#101828;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8"><tr><td class="email-outer" align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;table-layout:fixed;background:#ffffff;border:1px solid #e9edf1;border-radius:28px">
<tr><td class="email-section" style="padding:36px 40px;border-bottom:1px solid #edf0f3"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="64" style="vertical-align:middle;padding-right:16px"><img src="${escapeHtml(logoUrl)}" alt="Eduera logo" width="48" height="48" style="display:block;width:48px;height:48px;border:0"></td><td style="vertical-align:middle"><span style="font-size:28px;line-height:1.3;font-weight:bold;color:#101828">Eduera</span><br><span style="font-size:14px;line-height:1.6;color:#667085;letter-spacing:.5px">Your institution. Connected.</span></td></tr></table></td></tr>
<tr><td class="email-section" style="padding:36px 40px 40px">
<h1 class="email-heading" style="margin:0 0 16px;font-size:32px;line-height:1.25;letter-spacing:-1px;color:#101828">You're invited to join</h1>
<p style="font-size:17px;line-height:1.7;color:#667085;margin:0 0 32px">Your institution has invited you to collaborate on Eduera. Accept below to access your institution workspace.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;background:#f8fafb;border:1px solid #e4e7ec;border-radius:20px"><tr><td class="code-panel" style="padding:24px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="code-label" style="font-size:12px;font-weight:bold;color:#667085;letter-spacing:1px;padding-bottom:16px">INVITATION CODE</td><td class="code-label" align="right" style="font-size:12px;font-weight:bold;color:#4938c5;letter-spacing:1px;padding-bottom:16px">SINGLE-USE</td></tr></table>
<div style="background:#ffffff;border:1px solid #e4e7ec;border-radius:14px;padding:16px 20px">
<p class="invitation-code" style="margin:0;font-family:Consolas,'Courier New',monospace;font-size:36px;font-weight:bold;line-height:1.3;letter-spacing:6px;color:#101828;overflow-wrap:anywhere;word-break:break-all;user-select:all">${escapeHtml(input.token)}</p>
</div><p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#667085">Your email and code are filled in automatically when you accept. Keep this code as a backup.</p>
</td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;background:#f8fafb;border:1px solid #edf0f3;border-radius:16px"><tr><td style="padding:16px 20px;font-size:14px;line-height:1.7;color:#667085">Expires: &nbsp;<strong style="color:#344054;font-weight:600">${escapeHtml(displayExpiry)}</strong></td></tr></table>
<p style="margin:20px 0 28px;font-size:13px;line-height:1.6;color:#667085;overflow-wrap:anywhere;word-break:break-word">Invited email: <strong style="color:#344054">${escapeHtml(input.email)}</strong>. Already have an account? Use your current password.</p>
<table role="presentation" align="center" width="100%" cellspacing="0" cellpadding="0" style="margin:0 auto"><tr><td align="center" bgcolor="#4f40e8" style="border-radius:18px;background:#4f40e8"><a href="${escapeHtml(joinUrl)}" style="display:block;padding:20px 12px;border:1px solid #4f40e8;border-radius:18px;color:#ffffff;text-decoration:none;text-align:center;font-size:18px;line-height:1.5;font-weight:bold">Accept Invitation</a></td></tr></table>
<p style="margin:16px 0 0;text-align:center;font-size:13px;line-height:1.8;color:#667085">Trouble with the button? &nbsp;<a href="${escapeHtml(joinUrl)}" style="color:#4938c5;text-decoration:underline;font-weight:600">Open direct join portal</a></p>
</td></tr><tr><td class="email-section" style="padding:28px 40px;border-top:1px solid #edf0f3;border-radius:0 0 28px 28px;background:#f8fafb;text-align:center;font-size:13px;line-height:1.8;color:#667085"><p style="margin:0 0 20px">This single-use invite was intended strictly for you. Keep the code private and do not forward this email. If you weren't expecting this request, you can safely disregard this message.</p><p style="margin:0">&copy; Eduera</p></td></tr>
</table></td></tr></table></body></html>`;
  return {subject: 'Your invitation to Eduera', text, html, inlineImages:[invitationLogo]};
}
