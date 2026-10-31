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
import { BadRequestException, Controller, Get, Post, Param, Query, Req, Res, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { attachmentContentDisposition } from '../common/attachment-headers.js';
import { FacilitiesService } from './facilities.service.js';
let FacilitiesController = class FacilitiesController {
    facilities;
    constructor(facilities) {
        this.facilities = facilities;
    }
    workspace(req, school, query) { return this.facilities.workspace(req.authUser, school, query); }
    options(req, school, query) { return this.facilities.options(req.authUser, school, query); }
    settings(req, school) { return this.facilities.settings(req.authUser, school); }
    saveSettings(req, school) { return this.facilities.saveSettings(req.authUser, school, req.body); }
    settingsConfirmation(req, school, command) { return this.facilities.confirmation(req.authUser, school, school, z.uuid().parse(command), true); }
    report(req, school) { return this.facilities.report(req.authUser, school, req.body); }
    detail(req, school, id, query) { return this.facilities.detail(req.authUser, school, z.uuid().parse(id), query); }
    confirmation(req, school, id, command) { return this.facilities.confirmation(req.authUser, school, z.uuid().parse(id), z.uuid().parse(command)); }
    act(req, school, id) { return this.facilities.act(req.authUser, school, z.uuid().parse(id), req.body); }
    grantExternal(req, school, id) { return this.facilities.grantExternal(req.authUser, school, z.uuid().parse(id), req.body); }
    activateExternal(req, school, id, assignmentId) { return this.facilities.activateExternal(req.authUser, school, z.uuid().parse(id), z.uuid().parse(assignmentId), req.body); }
    endExternal(req, school, id, assignmentId) { return this.facilities.endExternal(req.authUser, school, z.uuid().parse(id), z.uuid().parse(assignmentId), req.body); }
    async addPhoto(req, school, id) {
        if (!req.isMultipart())
            throw new BadRequestException('Choose one repair photo using multipart form data.');
        const body = {};
        let upload;
        for await (const part of req.parts({ limits: { files: 1, fields: 2, fileSize: 5 * 1024 * 1024 } })) {
            if (part.type === 'file') {
                if (part.fieldname !== 'file' || upload)
                    throw new BadRequestException('Choose one repair photo.');
                const data = await part.toBuffer();
                if (part.file.truncated)
                    throw new BadRequestException('Choose a photo up to 5 MiB.');
                upload = { filename: part.filename, mimetype: part.mimetype, data };
            }
            else {
                if (Object.hasOwn(body, part.fieldname))
                    throw new BadRequestException('Use each repair photo field once.');
                body[part.fieldname] = part.fieldname === 'expected_revision' ? Number(part.value) : part.value;
            }
        }
        if (!upload)
            throw new BadRequestException('Choose a repair photo.');
        return this.facilities.addPhoto(req.authUser, school, z.uuid().parse(id), body, upload);
    }
    async photo(req, reply, school, id, photoId) {
        const file = await this.facilities.photo(req.authUser, school, z.uuid().parse(id), z.uuid().parse(photoId));
        reply.type(file.content_type).header('Content-Disposition', attachmentContentDisposition(file.original_name)).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').header('X-ThatCampus-Evidence-Mode', file.evidence_mode).header('X-ThatCampus-Source-Content-Omitted', String(file.source_content_omitted));
        return reply.send(file.stream);
    }
};
__decorate([
    Get('workspace'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "workspace", null);
__decorate([
    Get('options'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "options", null);
__decorate([
    Get('settings'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "settings", null);
__decorate([
    Post('settings'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "saveSettings", null);
__decorate([
    Get('settings/confirmation'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Query('command_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "settingsConfirmation", null);
__decorate([
    Post('repairs'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "report", null);
__decorate([
    Get('repairs/:id'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "detail", null);
__decorate([
    Get('repairs/:id/confirmation'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Query('command_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "confirmation", null);
__decorate([
    Post('repairs/:id/actions'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "act", null);
__decorate([
    Post('repairs/:id/external-access'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "grantExternal", null);
__decorate([
    Post('repairs/:id/external-access/:assignmentId/activate'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('assignmentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "activateExternal", null);
__decorate([
    Post('repairs/:id/external-access/:assignmentId/end'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __param(3, Param('assignmentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], FacilitiesController.prototype, "endExternal", null);
__decorate([
    Post('repairs/:id/photos'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], FacilitiesController.prototype, "addPhoto", null);
__decorate([
    Get('repairs/:id/photos/:photoId'),
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Param('schoolId')),
    __param(3, Param('id')),
    __param(4, Param('photoId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, String]),
    __metadata("design:returntype", Promise)
], FacilitiesController.prototype, "photo", null);
FacilitiesController = __decorate([
    Controller('api/v1/schools/:schoolId/facilities'),
    __metadata("design:paramtypes", [FacilitiesService])
], FacilitiesController);
export { FacilitiesController };
//# sourceMappingURL=facilities.controller.js.map