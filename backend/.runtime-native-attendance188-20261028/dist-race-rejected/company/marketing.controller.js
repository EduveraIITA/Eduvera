var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Body, Controller, Get, Header, Param, Post, Req } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import { CompanyService } from './company.service.js';
import { DatabaseService } from '../database/database.service.js';
let MarketingController = class MarketingController {
    company;
    db;
    constructor(company, db) {
        this.company = company;
        this.db = db;
    }
    async list(req) {
        await this.company.authorize(req.authUser);
        const rows = await sql `SELECT id,full_name,institution_name,institution_type,email,phone,location,student_count,message,status,created_at,
   (SELECT state FROM marketing_notification_jobs j WHERE j.enquiry_id=e.id) AS notification_state
   FROM marketing_enquiries e ORDER BY created_at DESC LIMIT 200`.execute(this.db);
        return { enquiries: rows.rows };
    }
    async update(req, id, body) {
        z.uuid().parse(id);
        const { status } = z.object({ status: z.enum(['new', 'contacted', 'closed']) }).strict().parse(body);
        return this.db.transaction().execute(async (db) => {
            await this.company.authorize(req.authUser, db);
            const result = await sql `UPDATE marketing_enquiries SET status=${status},reviewed_at=now(),reviewed_by=${req.authUser.id}::uuid WHERE id=${id}::uuid RETURNING id,status`.execute(db);
            await sql `INSERT INTO company_audit(actor_id,action,metadata) VALUES(${req.authUser.id}::uuid,'marketing.enquiry_reviewed',${JSON.stringify({ enquiry_id: id, status })}::jsonb)`.execute(db);
            return { enquiry: result.rows[0] ?? null };
        });
    }
};
__decorate([
    Get(),
    Header('Cache-Control', 'private, no-store'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MarketingController.prototype, "list", null);
__decorate([
    Post(':id/status'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MarketingController.prototype, "update", null);
MarketingController = __decorate([
    Controller('api/v1/company/enquiries'),
    __metadata("design:paramtypes", [CompanyService, DatabaseService])
], MarketingController);
export { MarketingController };
//# sourceMappingURL=marketing.controller.js.map