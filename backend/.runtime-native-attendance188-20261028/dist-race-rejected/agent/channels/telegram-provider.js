import { timingSafeEqual } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { config } from '../../config.js';
import { ChannelDeliveryError } from './provider.js';
function settings() {
    const value = config();
    return { enabled: value.TELEGRAM_BOT_ENABLED, token: value.TELEGRAM_BOT_TOKEN, webhookSecret: value.TELEGRAM_WEBHOOK_SECRET,
        ...(value.TELEGRAM_BOT_USERNAME ? { username: value.TELEGRAM_BOT_USERNAME } : {}), ...(value.PUBLIC_URL ? { publicUrl: value.PUBLIC_URL } : {}) };
}
function equalSecret(received, expected) {
    if (!received || !expected)
        return false;
    const left = Buffer.from(received);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}
function chunks(text) {
    const remaining = text.trim() || 'The assistant did not return a message.';
    if (remaining.length <= 3900)
        return [remaining];
    const result = [];
    let rest = remaining;
    while (rest.length > 3900) {
        const window = rest.slice(0, 3900);
        const split = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
        const end = split > 2400 ? split : 3900;
        result.push(rest.slice(0, end).trim());
        rest = rest.slice(end).trim();
    }
    if (rest)
        result.push(rest);
    return result;
}
export class TelegramChannelProvider {
    values;
    request;
    name = 'telegram';
    constructor(values = settings(), request = fetch) {
        this.values = values;
        this.request = request;
    }
    async initialize() {
        if (!this.values.enabled || this.values.username)
            return;
        const response = await this.request(`https://api.telegram.org/bot${this.values.token}/getMe`, { signal: AbortSignal.timeout(12_000) });
        let result;
        try {
            result = await response.json();
        }
        catch {
            result = null;
        }
        const envelope = result;
        const username = envelope?.result?.username;
        if (!response.ok || !envelope?.ok || envelope.result?.is_bot !== true || !username || !/^[A-Za-z0-9_]{5,64}$/.test(username)) {
            throw new ServiceUnavailableException('Telegram bot identity check is temporarily unavailable.');
        }
        this.values.username = username;
    }
    configured() { return this.values.enabled && Boolean(this.values.token && this.values.username && this.values.webhookSecret); }
    publicIdentity() { return { name: this.name, configured: this.configured(), label: 'Telegram', ...(this.values.username ? { username: `@${this.values.username}` } : {}) }; }
    connectionUrl(token) {
        if (!this.configured() || !this.values.username)
            throw new ServiceUnavailableException('Telegram is not configured yet.');
        return `https://t.me/${this.values.username}?start=${encodeURIComponent(token)}`;
    }
    parseWebhook(secret, body) {
        if (!this.configured())
            throw new ServiceUnavailableException('Telegram is not configured.');
        if (!equalSecret(secret, this.values.webhookSecret))
            throw new UnauthorizedException('Telegram webhook verification failed.');
        if (!body || typeof body !== 'object')
            throw new BadRequestException('Telegram update is invalid.');
        const update = body;
        const message = update.message;
        if (!message || typeof message !== 'object')
            return null;
        const row = message;
        const chat = row.chat;
        const from = row.from;
        if (!chat || typeof chat !== 'object' || !from || typeof from !== 'object')
            return null;
        const chatRow = chat;
        const fromRow = from;
        if (chatRow.type !== 'private' || typeof row.text !== 'string' || typeof update.update_id !== 'number' || !Number.isSafeInteger(update.update_id)
            || typeof row.message_id !== 'number' || !Number.isSafeInteger(row.message_id) || typeof chatRow.id !== 'number' || !Number.isSafeInteger(chatRow.id)
            || typeof fromRow.id !== 'number' || !Number.isSafeInteger(fromRow.id) || fromRow.id <= 0)
            return null;
        const text = row.text.trim();
        if (!text || text.length > 4000)
            return null;
        const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{20,100}))?$/i.exec(text);
        return { provider: this.name, updateId: String(update.update_id), externalUserId: String(fromRow.id), externalChatId: String(chatRow.id),
            messageId: String(row.message_id), senderLabel: [fromRow.first_name, fromRow.last_name].filter(item => typeof item === 'string').join(' ').slice(0, 120),
            text, ...(start?.[1] ? { linkToken: start[1] } : {}) };
    }
    async send(input, checkpoint) {
        if (!this.configured())
            throw new ServiceUnavailableException('Telegram is not configured.');
        const parts = chunks(input.text);
        const messageIds = [];
        for (let index = 0; index < parts.length; index++) {
            const dispatch = async () => {
                const part = { externalChatId: input.externalChatId, text: parts[index],
                    ...(index === parts.length - 1 && input.action ? { action: input.action } : {}) };
                const prior = checkpoint ? await checkpoint.beforePart(index, parts.length, part) : null;
                if (prior !== null)
                    return prior;
                const payload = { chat_id: input.externalChatId, text: parts[index], disable_web_page_preview: true };
                if (index === parts.length - 1 && input.action)
                    payload.reply_markup = { inline_keyboard: [[{ text: input.action.label, url: input.action.url }]] };
                let messageId;
                try {
                    const response = await this.request(`https://api.telegram.org/bot${this.values.token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000) });
                    let result;
                    try {
                        result = await response.json();
                    }
                    catch {
                        result = null;
                    }
                    const envelope = result;
                    if (envelope?.ok === false)
                        throw new ChannelDeliveryError('rejected');
                    if (!response.ok || envelope?.ok !== true || !Number.isSafeInteger(envelope.result?.message_id))
                        throw new ChannelDeliveryError('unknown');
                    messageId = String(envelope.result.message_id);
                }
                catch (error) {
                    const acceptance = error instanceof ChannelDeliveryError ? error.acceptance : 'unknown';
                    await checkpoint?.failed(index, acceptance);
                    throw error instanceof ChannelDeliveryError ? error : new ChannelDeliveryError(acceptance);
                }
                // Persist the acknowledgement before moving on. A lost DB acknowledgement
                // leaves 'sending', which recovery treats as uncertain, never as unsent.
                await checkpoint?.accepted(index, messageId);
                return messageId;
            };
            messageIds.push(await (checkpoint?.withPart ? checkpoint.withPart(dispatch) : dispatch()));
        }
        return { messageIds };
    }
    async registerWebhook() {
        if (!this.configured() || !this.values.publicUrl)
            throw new ServiceUnavailableException('Telegram webhook configuration is incomplete.');
        const response = await this.request(`https://api.telegram.org/bot${this.values.token}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: `${this.values.publicUrl}/api/v1/agent/channels/telegram/webhook`, secret_token: this.values.webhookSecret,
                allowed_updates: ['message'], drop_pending_updates: false }), signal: AbortSignal.timeout(12_000) });
        const result = await response.json();
        if (!response.ok || !result.ok)
            throw new ServiceUnavailableException(`Telegram webhook setup failed${result.description ? `: ${result.description.slice(0, 180)}` : ''}.`);
    }
}
//# sourceMappingURL=telegram-provider.js.map