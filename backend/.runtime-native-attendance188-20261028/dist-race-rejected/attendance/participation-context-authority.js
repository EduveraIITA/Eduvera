var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { ConflictException, Injectable } from "@nestjs/common";
/** Owning domains recheck their own invariants; no dependency on their modules. */
let ParticipationContextAuthorityRegistry = class ParticipationContextAuthorityRegistry {
    evaluators = new Map();
    register(source, evaluator) {
        if (this.evaluators.has(source))
            throw new ConflictException(`The ${source} participation adapter is already registered.`);
        this.evaluators.set(source, evaluator);
    }
    evaluate(source, tx, user, context) {
        const evaluator = this.evaluators.get(source);
        if (!evaluator)
            throw new ConflictException(`The ${source} participation authority adapter is unavailable.`);
        return evaluator(tx, user, context);
    }
};
ParticipationContextAuthorityRegistry = __decorate([
    Injectable()
], ParticipationContextAuthorityRegistry);
export { ParticipationContextAuthorityRegistry };
//# sourceMappingURL=participation-context-authority.js.map