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
import { Body, Controller, Get, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import { CampusScenesModule } from '../campus-scenes/campus-scenes.module.js';
import { CampusSceneImportProvider } from './scene-import.provider.js';
import { CampusSceneImportService } from './scene-import.service.js';
let CampusSceneImportController = class CampusSceneImportController {
    importer;
    constructor(importer) {
        this.importer = importer;
    }
    capabilities(request, school, campus) { return this.importer.capabilities(request.authUser, school, campus); }
    lookup(request, school, campus, body) { return this.importer.lookup(request.authUser, school, campus, body); }
    import(request, school, campus, body) { return this.importer.import(request.authUser, school, campus, body); }
};
__decorate([
    Get('capabilities/'),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('campusId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CampusSceneImportController.prototype, "capabilities", null);
__decorate([
    Post('lookup/'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('campusId')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusSceneImportController.prototype, "lookup", null);
__decorate([
    Post('/'),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param('schoolId')),
    __param(2, Param('campusId')),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], CampusSceneImportController.prototype, "import", null);
CampusSceneImportController = __decorate([
    Controller('api/v1/schools/:schoolId/campus-scenes/:campusId/imports'),
    __metadata("design:paramtypes", [CampusSceneImportService])
], CampusSceneImportController);
export { CampusSceneImportController };
let CampusSceneImportModule = class CampusSceneImportModule {
};
CampusSceneImportModule = __decorate([
    Module({ imports: [CampusScenesModule], controllers: [CampusSceneImportController], providers: [CampusSceneImportProvider, CampusSceneImportService] })
], CampusSceneImportModule);
export { CampusSceneImportModule };
//# sourceMappingURL=scene-import.module.js.map