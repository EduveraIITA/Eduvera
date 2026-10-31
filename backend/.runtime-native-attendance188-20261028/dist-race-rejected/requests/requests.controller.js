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
import { Controller, Get, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { RequestsService } from "./requests.service.js";
let RequestsController = class RequestsController {
    requests;
    constructor(requests) {
        this.requests = requests;
    }
    inbox(request, query) {
        return this.requests.inbox(request.authUser, query);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], RequestsController.prototype, "inbox", null);
RequestsController = __decorate([
    ApiTags("requests"),
    ApiCookieAuth(),
    Controller("api/v1/requests"),
    __metadata("design:paramtypes", [RequestsService])
], RequestsController);
export { RequestsController };
//# sourceMappingURL=requests.controller.js.map