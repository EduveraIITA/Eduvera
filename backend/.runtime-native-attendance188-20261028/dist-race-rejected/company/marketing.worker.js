var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import { config } from '../config.js';
import { sendTransactionalEmail } from '../common/email-transport.js';
let MarketingNotificationWorker = class MarketingNotificationWorker {
    db;
    timer;
    busy = false;
    constructor(db) {
        this.db = db;
    }
    onModuleInit() { this.timer = setInterval(() => void this.tick(), 30000); this.timer.unref(); }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async tick() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            // A crashed send is unconfirmed; do not risk duplicate mail by retrying it.
            await sql `UPDATE marketing_notification_jobs SET state='unknown',finished_at=now() WHERE state='sending' AND attempted_at<now()-interval '5 minutes'`.execute(this.db);
            await sql `DELETE FROM marketing_rate_limits WHERE expires_at<now()`.execute(this.db);
            await sql `DELETE FROM marketing_enquiries WHERE created_at<now()-interval '12 months'`.execute(this.db);
            const recipient = process.env.MARKETING_NOTIFY_TO;
            if (!config().INVITATION_EMAIL_ENABLED || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
                return;
            const result = await sql `UPDATE marketing_notification_jobs SET state='sending',attempted_at=now()
    WHERE id=(SELECT id FROM marketing_notification_jobs WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,enquiry_id`.execute(this.db);
            const job = result.rows[0];
            if (!job)
                return;
            try {
                await sendTransactionalEmail({ to: recipient, senderName: 'ThatCampus', subject: 'New ThatCampus demo enquiry', text: `A new enquiry is ready for review.\nReference: ${job.enquiry_id}\nOpen the company console: ${config().PUBLIC_URL}/company\nSign in with your company operator account. Form details are available only in the protected console.` });
                await sql `UPDATE marketing_notification_jobs SET state='accepted',finished_at=now() WHERE id=${job.id}::uuid`.execute(this.db);
            }
            catch {
                await sql `UPDATE marketing_notification_jobs SET state='unknown',finished_at=now() WHERE id=${job.id}::uuid`.execute(this.db);
            }
        }
        catch { /* Database/provider outages never expose enquiry data to logs. */ }
        finally {
            this.busy = false;
        }
    }
};
MarketingNotificationWorker = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], MarketingNotificationWorker);
export { MarketingNotificationWorker };
//# sourceMappingURL=marketing.worker.js.map