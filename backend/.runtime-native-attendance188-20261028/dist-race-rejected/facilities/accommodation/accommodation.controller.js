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
import { Controller, Get, Post, Param, Query, Req, HttpCode, } from "@nestjs/common";
import { z } from "zod";
import { AccommodationService } from "./accommodation.service.js";
let AccommodationController = class AccommodationController {
    accommodation;
    constructor(accommodation) {
        this.accommodation = accommodation;
    }
    workspace(req, school, query) {
        return this.accommodation.workspace(req.authUser, school, query);
    }
    options(req, school, query) {
        return this.accommodation.options(req.authUser, school, query);
    }
    room(req, school, id) {
        return this.accommodation.room(req.authUser, school, z.uuid().parse(id));
    }
    saveType(req, school) {
        return this.accommodation.saveRoomType(req.authUser, school, req.body);
    }
    saveRoom(req, school) {
        return this.accommodation.saveRoom(req.authUser, school, req.body);
    }
    savePlace(req, school) {
        return this.accommodation.savePlace(req.authUser, school, req.body);
    }
    setupConfirmation(req, school, command) {
        return this.accommodation.setupConfirmation(req.authUser, school, z.uuid().parse(command));
    }
    offer(req, school) {
        return this.accommodation.offer(req.authUser, school, req.body);
    }
    detail(req, school, id, query) {
        return this.accommodation.detail(req.authUser, school, z.uuid().parse(id), query);
    }
    act(req, school, id) {
        return this.accommodation.act(req.authUser, school, z.uuid().parse(id), req.body);
    }
    link(req, school, id) {
        return this.accommodation.linkAccess(req.authUser, school, z.uuid().parse(id), req.body);
    }
    confirmation(req, school, id, command) {
        return this.accommodation.confirmation(req.authUser, school, z.uuid().parse(id), z.uuid().parse(command));
    }
};
__decorate([
    Get("workspace"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "workspace", null);
__decorate([
    Get("options"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "options", null);
__decorate([
    Get("rooms/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "room", null);
__decorate([
    Post("room-types"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "saveType", null);
__decorate([
    Post("rooms"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "saveRoom", null);
__decorate([
    Post("places"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "savePlace", null);
__decorate([
    Get("setup/confirmation"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "setupConfirmation", null);
__decorate([
    Post("stays"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "offer", null);
__decorate([
    Get("stays/:id"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "detail", null);
__decorate([
    Post("stays/:id/actions"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "act", null);
__decorate([
    Post("stays/:id/access-loans"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "link", null);
__decorate([
    Get("stays/:id/confirmation"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("id")),
    __param(3, Query("command_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], AccommodationController.prototype, "confirmation", null);
AccommodationController = __decorate([
    Controller("api/v1/schools/:schoolId/facilities/accommodation"),
    __metadata("design:paramtypes", [AccommodationService])
], AccommodationController);
export { AccommodationController };
//# sourceMappingURL=accommodation.controller.js.map